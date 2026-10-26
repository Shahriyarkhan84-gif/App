// iPhone "install" profile: a configuration profile (.mobileconfig) with one Web Clip that puts the
// brand's icon on the Home Screen and opens the web app full screen. Built per brand from
// brands/<id>/brand.json during build:web and served at /ios.mobileconfig.
// Unsigned profiles show "Not Verified" on iOS; see docs/ENVIRONMENT.md to sign one.
import { createHash } from 'node:crypto';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Same brand → same UUIDs, so installing again replaces the profile instead of adding a second icon.
const uuid = (seed) => {
  const h = createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase();
};

/** @param {{ name: string; legalName?: string; website: string; app: { iosBundleId: string } }} brand  @param {Buffer} icon PNG */
export function iosProfile(brand, icon) {
  const id = brand.app.iosBundleId;
  const url = `${brand.website.replace(/\/$/, '')}/welcome`;
  const data = icon.toString('base64').replace(/.{1,64}/g, '$&\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>FullScreen</key><true/>
      <key>Icon</key>
      <data>
${data}      </data>
      <key>IsRemovable</key><true/>
      <key>Label</key><string>${xml(brand.name)}</string>
      <key>Precomposed</key><true/>
      <key>URL</key><string>${xml(url)}</string>
      <key>PayloadDisplayName</key><string>${xml(brand.name)}</string>
      <key>PayloadIdentifier</key><string>${xml(id)}.webclip</string>
      <key>PayloadType</key><string>com.apple.webClip.managed</string>
      <key>PayloadUUID</key><string>${uuid(`${id}.webclip`)}</string>
      <key>PayloadVersion</key><integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key><string>Adds ${xml(brand.name)} to your Home Screen. It opens ${xml(url)} full screen and changes nothing else on your iPhone.</string>
  <key>PayloadDisplayName</key><string>${xml(brand.name)}</string>
  <key>PayloadIdentifier</key><string>${xml(id)}.profile</string>
  <key>PayloadOrganization</key><string>${xml(brand.legalName ?? brand.name)}</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${uuid(`${id}.profile`)}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>
`;
}
