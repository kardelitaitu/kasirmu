//! Auth / Token endpoints.

import type { HttpClient } from './client';
import type { CreateTokenRequest, CreateTokenResponse, TokenResponse } from './types';

export class AuthClient {
  constructor(private readonly http: HttpClient) {}

  /** `POST /api/v1/tokens` — create a new JWT API token. */
  async createToken(req: CreateTokenRequest): Promise<TokenResponse> {
    // The body is the `{ token: {...} }` envelope, so the details have to be
    // unwrapped here. Returning the envelope as-is typed a `TokenResponse` whose
    // `.token` was the envelope object rather than the JWT string, so every
    // `Authorization: Bearer` built from it carried `[object Object]` and an
    // `.expires_at` read of it was undefined rather than absent.
    const envelope = await this.http.request<CreateTokenResponse>(
      'POST',
      '/api/v1/tokens',
      req,
    );
    return envelope.token;
  }
}
