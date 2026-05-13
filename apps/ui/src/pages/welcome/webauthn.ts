// WebAuthn / base-encoding helpers used by the WelcomePage auth flow.

export function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const decoded = atob(padded + "=".repeat(padLen));
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

export function decodeCreateOptions(
  ccr: Record<string, unknown>,
): PublicKeyCredentialCreationOptions {
  const pk = (ccr.publicKey ?? ccr) as Record<string, unknown>;
  const user = pk.user as Record<string, unknown>;
  const excludeRaw = (pk.excludeCredentials ?? []) as Array<{
    id: string;
    type: string;
    transports?: AuthenticatorTransport[];
  }>;
  return {
    challenge: b64uDecode(pk.challenge as string),
    rp: pk.rp as PublicKeyCredentialRpEntity,
    user: {
      id: b64uDecode(user.id as string),
      name: user.name as string,
      displayName: user.displayName as string,
    },
    pubKeyCredParams: pk.pubKeyCredParams as PublicKeyCredentialParameters[],
    timeout: pk.timeout as number | undefined,
    attestation: pk.attestation as AttestationConveyancePreference | undefined,
    authenticatorSelection: pk.authenticatorSelection as AuthenticatorSelectionCriteria | undefined,
    excludeCredentials: excludeRaw.map((c) => ({
      id: b64uDecode(c.id),
      type: "public-key" as const,
      transports: c.transports,
    })),
  };
}

export function decodeRequestOptions(
  rcr: Record<string, unknown>,
): PublicKeyCredentialRequestOptions {
  const pk = (rcr.publicKey ?? rcr) as Record<string, unknown>;
  const allowRaw = (pk.allowCredentials ?? []) as Array<{
    id: string;
    type: string;
    transports?: AuthenticatorTransport[];
  }>;
  return {
    challenge: b64uDecode(pk.challenge as string),
    rpId: pk.rpId as string | undefined,
    timeout: pk.timeout as number | undefined,
    userVerification: pk.userVerification as UserVerificationRequirement | undefined,
    allowCredentials: allowRaw.map((c) => ({
      id: b64uDecode(c.id),
      type: "public-key" as const,
      transports: c.transports,
    })),
  };
}

export function encodeRegistrationCredential(cred: PublicKeyCredential) {
  const att = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: b64uEncode(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: b64uEncode(att.clientDataJSON),
      attestationObject: b64uEncode(att.attestationObject),
    },
    extensions: cred.getClientExtensionResults?.() ?? {},
  };
}

export function encodeAssertionCredential(cred: PublicKeyCredential) {
  const ass = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: b64uEncode(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: b64uEncode(ass.clientDataJSON),
      authenticatorData: b64uEncode(ass.authenticatorData),
      signature: b64uEncode(ass.signature),
      userHandle: ass.userHandle ? b64uEncode(ass.userHandle) : null,
    },
    extensions: cred.getClientExtensionResults?.() ?? {},
  };
}

export function base58Encode(bytes: Uint8Array): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      const v = digits[j] * 256 + carry;
      digits[j] = v % 58;
      carry = Math.floor(v / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "";
  for (let i = 0; i < zeros; i++) out += "1";
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}
