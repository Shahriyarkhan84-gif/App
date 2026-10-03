import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * S3 access for media. Sources go to a private uploads bucket (clients get a
 * short-lived presigned PUT for one exact key); outputs live in a media
 * bucket served through CloudFront (MEDIA_BASE_URL). Stand-in for the
 * Supabase `uploads` / `media` buckets and their storage policies.
 */
@Injectable()
export class MediaStorageService {
  private readonly s3: S3Client;

  constructor(private readonly config: ConfigService) {
    this.s3 = new S3Client({ region: config.get<string>('AWS_REGION') ?? 'ap-south-1' });
  }

  private get uploadsBucket() {
    return this.config.getOrThrow<string>('MEDIA_UPLOADS_BUCKET');
  }

  /** Presigned PUT for exactly this key and content type, valid for an hour. */
  presignUpload(key: string, contentType: string): Promise<string> {
    return getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.uploadsBucket, Key: key, ContentType: contentType }), { expiresIn: 3600 });
  }

  /** Size of an uploaded source, or null if it isn't there. */
  async uploadedSize(key: string): Promise<number | null> {
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.uploadsBucket, Key: key }));
      return head.ContentLength ?? 0;
    } catch {
      return null;
    }
  }

  publicUrl(path: string | null): string | null {
    const base = this.config.get<string>('MEDIA_BASE_URL');
    return base && path ? `${base.replace(/\/$/, '')}/${path}` : null;
  }
}
