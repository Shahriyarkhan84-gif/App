// In-app host application. The app posts multipart/form-data with the user's
// details and three photos (CNIC front, CNIC back, face holding the CNIC).
// Photos go straight to Didit's ID-verification and face-match APIs and are
// never stored by Zynalive; the decision is recorded by
// internal_submit_host_application() (no images, only the last 4 CNIC digits).
import { requireUser } from '../_shared/auth.ts';
import { handler, HttpError, json, requireEnv, rpcError } from '../_shared/cors.ts';
import { cnicMatches, IMAGE_TYPES, MAX_IMAGE_BYTES, nameMatches, normalizeCnic, normalizePkMobile } from '../_shared/host_application.ts';
import { rateLimit } from '../_shared/redis.ts';
import { adminClient } from '../_shared/supabase.ts';

const DIDIT = 'https://verification.didit.me/v3';

type IdResult = {
  request_id?: string;
  id_verification?: {
    status?: string; full_name?: string; document_number?: string; personal_number?: string; age?: number; portrait_image?: string;
  };
};
type FaceResult = { request_id?: string; face_match?: { status?: string; score?: number } };

async function diditForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${DIDIT}${path}`, { method: 'POST', headers: { 'x-api-key': requireEnv('DIDIT_API_KEY') }, body: form });
  if (!res.ok) {
    console.error('Didit error', path, res.status, await res.text().catch(() => ''));
    throw new HttpError(502, 'verification_unavailable', 'Verification service unavailable. Please try again.');
  }
  return (await res.json()) as T;
}

function image(form: FormData, key: string): File {
  const f = form.get(key);
  if (!(f instanceof File) || f.size === 0) throw new HttpError(400, 'missing_photo', `Add the ${key} photo.`);
  if (f.size > MAX_IMAGE_BYTES) throw new HttpError(400, 'photo_too_large', 'Each photo must be under 5 MB.');
  if (f.type && !IMAGE_TYPES.includes(f.type)) throw new HttpError(400, 'invalid_photo', 'Use a JPEG, PNG or WebP photo.');
  return f;
}

function base64ToFile(b64: string, name: string) {
  const bin = atob(b64.replace(/^data:[^,]+,/, ''));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new File([bytes], name, { type: 'image/jpeg' });
}

Deno.serve(
  handler(async (req) => {
    const { userId } = await requireUser(req);
    await rateLimit('host-application', userId, 5, '24 h');

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new HttpError(400, 'invalid_form');
    }
    const fullName = String(form.get('full_name') ?? '').trim();
    const phone = normalizePkMobile(String(form.get('phone') ?? ''));
    const cnic = normalizeCnic(String(form.get('cnic') ?? ''));
    const agencyCode = String(form.get('agency_code') ?? '').trim();
    if (fullName.length < 3 || fullName.length > 80) throw new HttpError(400, 'invalid_name', 'Enter your full name as on your CNIC.');
    if (!phone) throw new HttpError(400, 'invalid_phone', 'Enter a valid mobile number.');
    if (!cnic) throw new HttpError(400, 'invalid_cnic', 'CNIC number must be 13 digits.');
    if (!agencyCode) throw new HttpError(400, 'agency_code_required', 'Enter your agency code.');
    if (!/^[1-9][0-9]{3}$/.test(agencyCode)) throw new HttpError(400, 'invalid_agency_code', 'Agency code is 4 digits.');
    const front = image(form, 'cnic_front');
    const back = image(form, 'cnic_back');
    const selfie = image(form, 'selfie');

    const db = adminClient();
    // Cheap checks before spending a Didit credit.
    const { data: host } = await db.from('hosts').select('verification_status').eq('user_id', userId).maybeSingle();
    if (host?.verification_status === 'approved') throw new HttpError(409, 'already_verified');
    const { data: agency } = await db.from('agencies').select('id').eq('code', agencyCode).eq('status', 'active').maybeSingle();
    if (!agency) throw new HttpError(400, 'invalid_agency_code', 'That agency code was not found.');

    // 1) ID document: OCR + authenticity.
    const idForm = new FormData();
    idForm.append('front_image', front, 'cnic_front.jpg');
    idForm.append('back_image', back, 'cnic_back.jpg');
    idForm.append('vendor_data', userId);
    const idRes = await diditForm<IdResult>('/id-verification/', idForm);
    const id = idRes.id_verification ?? {};

    // 2) Face on the "holding CNIC" photo vs the CNIC portrait (or the front image if no portrait).
    const faceForm = new FormData();
    faceForm.append('user_image', selfie, 'selfie.jpg');
    faceForm.append('ref_image', id.portrait_image ? base64ToFile(id.portrait_image, 'portrait.jpg') : front, 'reference.jpg');
    faceForm.append('face_match_score_decline_threshold', '50');
    faceForm.append('rotate_image', 'true');
    faceForm.append('vendor_data', userId);
    const faceRes = await diditForm<FaceResult>('/face-match/', faceForm);

    const { data, error } = await db.rpc('internal_submit_host_application', {
      p_user: userId,
      p_full_name: fullName,
      p_phone: phone,
      p_cnic_last4: cnic.slice(-4),
      p_agency_code: agencyCode,
      p_id_status: id.status ?? null,
      p_face_status: faceRes.face_match?.status ?? null,
      p_face_score: faceRes.face_match?.score != null ? Math.round(faceRes.face_match.score) : null,
      p_cnic_match: cnicMatches(cnic, id.personal_number, id.document_number),
      p_name_match: nameMatches(fullName, id.full_name),
      p_age: typeof id.age === 'number' ? id.age : null,
      p_id_request: idRes.request_id ?? null,
      p_face_request: faceRes.request_id ?? null,
    });
    if (error) rpcError(error);
    return json(data);
  }),
);
