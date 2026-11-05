// Read-only Bluetooth diagnostics. It lists what a bulb exposes so the protocol can be identified
// from evidence. It never writes to a characteristic, never pairs, and never tries a key.
//
// Web Bluetooth only shows services the page names in advance, so the list below is what we ask
// to see. Matching one of them is a hint about the chip family, not proof of a protocol.

const sig = (n) => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;

export const KNOWN_SERVICES = [
  { uuid: sig(0x1800), name: 'Generic Access', source: 'Bluetooth SIG' },
  { uuid: sig(0x1801), name: 'Generic Attribute', source: 'Bluetooth SIG' },
  { uuid: sig(0x180a), name: 'Device Information', source: 'Bluetooth SIG' },
  { uuid: sig(0x180f), name: 'Battery', source: 'Bluetooth SIG' },
  { uuid: sig(0x1827), name: 'Mesh Provisioning (an unpaired Bluetooth Mesh device)', source: 'Bluetooth SIG', family: 'mesh-new' },
  { uuid: sig(0x1828), name: 'Mesh Proxy (a Bluetooth Mesh device already paired to an app)', source: 'Bluetooth SIG', family: 'mesh' },
  { uuid: sig(0x1910), name: 'Tuya BLE service, as described by open-source Tuya BLE projects', source: 'community', family: 'tuya' },
  { uuid: sig(0xfd50), name: 'Tuya-assigned 16-bit UUID', source: 'Bluetooth SIG member list', family: 'tuya' },
  { uuid: '00010203-0405-0607-0809-0a0b0c0d1910', name: 'Telink mesh service, as described by open-source Telink projects', source: 'community', family: 'telink' },
  { uuid: sig(0xffe0), name: 'Vendor service FFE0, common on simple LED controllers', source: 'unregistered', family: 'vendor' },
  { uuid: sig(0xffe5), name: 'Vendor service FFE5, common on simple LED controllers', source: 'unregistered', family: 'vendor' },
  { uuid: sig(0xfff0), name: 'Vendor service FFF0', source: 'unregistered', family: 'vendor' },
  { uuid: sig(0xff00), name: 'Vendor service FF00', source: 'unregistered', family: 'vendor' },
];

const TEXT_CHARS = {
  [sig(0x2a00)]: 'Device name', [sig(0x2a24)]: 'Model number', [sig(0x2a25)]: 'Serial number',
  [sig(0x2a26)]: 'Firmware', [sig(0x2a27)]: 'Hardware', [sig(0x2a28)]: 'Software', [sig(0x2a29)]: 'Manufacturer',
};

export function bleSupport() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!window.isSecureContext) return { ok: false, reason: 'Bluetooth needs HTTPS or localhost.' };
  if (!navigator.bluetooth) {
    if (ios) return { ok: false, reason: 'iPhone and iPad browsers have no Web Bluetooth: Safari and Chrome on iOS both use WebKit, which leaves it out. Use a computer or an Android phone with Chrome.' };
    if (/Firefox\//.test(ua)) return { ok: false, reason: 'Firefox has no Web Bluetooth. Use Chrome or Edge.' };
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return { ok: false, reason: 'Safari has no Web Bluetooth. Use Chrome or Edge.' };
    return { ok: false, reason: 'This browser has no Web Bluetooth. Use Chrome or Edge on a computer, or Chrome on Android.' };
  }
  return { ok: true, reason: '' };
}

const hex = (dv) => [...new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)].map((b) => b.toString(16).padStart(2, '0')).join(' ');

// Shows the browser's device picker, then reads what the chosen device exposes.
export async function probeDevice(log = () => {}) {
  const report = {
    at: new Date().toISOString(), browser: navigator.userAgent,
    device: null, advertisement: null, services: [], hints: [], errors: [],
  };
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: KNOWN_SERVICES.map((s) => s.uuid),
  });
  report.device = { name: device.name || '(no name)', id: device.id };
  log(`Chosen: ${report.device.name}`);

  // Advertising data needs an experimental Chrome flag. Without it this step is skipped.
  if (device.watchAdvertisements) {
    try {
      const ad = await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('No advertisement within 5 s')), 5000);
        device.addEventListener('advertisementreceived', (e) => { clearTimeout(t); resolve(e); }, { once: true });
        device.watchAdvertisements().catch(reject);
      });
      report.advertisement = {
        rssi: ad.rssi, txPower: ad.txPower, uuids: ad.uuids,
        manufacturerData: [...ad.manufacturerData].map(([company, dv]) => ({ company: `0x${company.toString(16).padStart(4, '0')}`, bytes: hex(dv) })),
        serviceData: [...ad.serviceData].map(([uuid, dv]) => ({ uuid, bytes: hex(dv) })),
      };
      log(`Advertisement: RSSI ${ad.rssi}`);
    } catch (err) {
      report.errors.push(`Advertisement: ${err.message}`);
    }
  }

  log('Connecting to read its services…');
  let server;
  try {
    server = await device.gatt.connect();
  } catch (err) {
    report.errors.push(`Connect: ${err.message}`);
    report.hints.push('The bulb did not accept a connection. If the phone app is connected to it, close the app or turn the phone’s Bluetooth off, then try again.');
    return report;
  }
  try {
    const services = await server.getPrimaryServices();
    for (const svc of services) {
      const known = KNOWN_SERVICES.find((k) => k.uuid === svc.uuid);
      const entry = { uuid: svc.uuid, name: known?.name || 'Unknown', characteristics: [] };
      try {
        for (const ch of await svc.getCharacteristics()) {
          const p = ch.properties;
          const c = { uuid: ch.uuid, props: ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].filter((k) => p[k]) };
          // Only plain text identity fields are read. Nothing else is touched.
          if (p.read && TEXT_CHARS[ch.uuid]) {
            try { c.value = new TextDecoder().decode(await ch.readValue()); c.label = TEXT_CHARS[ch.uuid]; } catch (err) { c.readError = err.message; }
          }
          entry.characteristics.push(c);
        }
      } catch (err) { entry.error = err.message; }
      report.services.push(entry);
      log(`Service ${entry.name}`);
    }
  } catch (err) {
    report.errors.push(`Services: ${err.message}`);
  } finally {
    device.gatt.disconnect();
  }
  report.hints.push(...interpret(report));
  return report;
}

export function interpret(report) {
  const fam = new Set(report.services.map((s) => KNOWN_SERVICES.find((k) => k.uuid === s.uuid)?.family).filter(Boolean));
  (report.advertisement?.serviceData || []).forEach((d) => { const k = KNOWN_SERVICES.find((x) => x.uuid === d.uuid); if (k?.family) fam.add(k.family); });
  const out = [];
  if (fam.has('mesh') || fam.has('mesh-new')) out.push('Bluetooth Mesh. Control needs the network and application keys the phone app created when pairing. A browser cannot practically speak Mesh, so this route needs a bridge program or the vendor’s cloud.');
  if (fam.has('tuya')) out.push('Looks like Tuya BLE. Commands are encrypted with a per-device key held in your Tuya account. With that key from your own account, a direct adapter is possible.');
  if (fam.has('telink')) out.push('Looks like a Telink mesh chip. Older Telink mesh lamps use a mesh name and password set in the app.');
  if (fam.has('vendor')) out.push('A vendor service common on simple LED controllers. These are sometimes unencrypted, but the commands must still be confirmed from a capture of the phone app.');
  if (!out.length && report.services.length) out.push('No known lamp service among those this page is allowed to see. Send this report so the next step can be planned.');
  return out;
}
