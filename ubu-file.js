/* .ubu issuance files. Trust is supplied by the caller, never by the file. */
(function(root) {
  'use strict';
  const MAX_BYTES = 1024;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const fields = ['mint', 'id', 'serial', 'dna', 'issuedAt', 'key'];

  function encode(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(value, size, label) {
    if (typeof value !== 'string' || value.length !== Math.ceil(size * 8 / 6) || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error(`Invalid ${label}.`);
    }
    const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
    if (bytes.length !== size || encode(bytes) !== value) throw new Error(`Noncanonical ${label}.`);
    return bytes;
  }
  function certificate(data) {
    decode(data.mint, 16, 'mint ID');
    decode(data.id, 16, 'ubu ID');
    if (typeof data.serial !== 'string' || !/^(?!0{12}$)[0-9]{12}$/.test(data.serial)) throw new Error('Invalid ubu serial number.');
    decode(data.dna, 32, 'DNA');
    if (!Number.isSafeInteger(data.issuedAt) || data.issuedAt < 0) throw new Error('Invalid issuance time.');
    if (typeof data.key !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(data.key)) throw new Error('Invalid signing-key ID.');
    return { type: 'ubu-signed', mint: data.mint, id: data.id, serial: data.serial, dna: data.dna, issuedAt: data.issuedAt, key: data.key };
  }
  function signingBytes(data) {
    return encoder.encode('ubumint:issuance\n' + JSON.stringify(data));
  }
  function unsigned(dna) {
    decode(dna, 32, 'DNA');
    return JSON.stringify({ type: 'ubu', dna });
  }
  async function sign(data, privateKey) {
    if (!data || typeof data !== 'object' || Object.keys(data).length !== fields.length || Object.keys(data).some(key => !fields.includes(key))) {
      throw new Error('Provide exactly mint, id, serial, dna, issuedAt and key.');
    }
    const value = certificate(data);
    if (privateKey?.type !== 'private' || privateKey.algorithm?.name !== 'Ed25519') throw new Error('An Ed25519 private key is required.');
    const signature = new Uint8Array(await root.crypto.subtle.sign('Ed25519', privateKey, signingBytes(value)));
    return JSON.stringify({ ...value, signature: encode(signature) });
  }
  async function read(input, { allowUnsigned = true, resolveKey } = {}) {
    if (!(typeof input === 'string' || input instanceof Uint8Array) || !input.length || input.length > MAX_BYTES) {
      throw new Error('A .ubu file must contain 1–1024 bytes.');
    }
    const bytes = typeof input === 'string' ? encoder.encode(input) : input;
    if (bytes.byteLength > MAX_BYTES) throw new Error('A .ubu file must contain 1–1024 bytes.');
    let text, data;
    try { text = decoder.decode(bytes); data = JSON.parse(text); } catch { throw new Error('Invalid UTF-8 JSON .ubu file.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid .ubu object.');
    if (data.type === 'ubu') {
      const canonical = unsigned(data.dna);
      if (text !== canonical) throw new Error('Noncanonical unsigned .ubu file.');
      if (!allowUnsigned) throw new Error('This host requires mint-signed ubus.');
      return Object.freeze({ type: 'unsigned', dna: data.dna });
    }
    if (data.type !== 'ubu-signed') throw new Error('Unknown .ubu file type.');
    const value = certificate(data);
    const signature = decode(data.signature, 64, 'signature');
    if (text !== JSON.stringify({ ...value, signature: data.signature })) throw new Error('Noncanonical signed .ubu file.');
    const publicKey = typeof resolveKey === 'function' ? await resolveKey(value.mint, value.key) : null;
    if (!publicKey) throw new Error('The mint signing key is not trusted.');
    if (publicKey.type !== 'public' || publicKey.algorithm?.name !== 'Ed25519') throw new Error('A trusted Ed25519 public key is required.');
    const valid = await root.crypto.subtle.verify('Ed25519', publicKey, signature, signingBytes(value));
    if (!valid) throw new Error('Invalid mint signature.');
    return Object.freeze({ type: 'signed', dna: value.dna, certificate: Object.freeze({ ...value, signature: data.signature }) });
  }
  const api = { MAX_BYTES, unsigned, sign, read };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ubuFile = api;
})(globalThis);
