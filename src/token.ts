const REFRESH_MARGIN_MS = 60_000;

/** OAuth client credentials token from XSUAA, cached until shortly before it expires. */
export class ClientCredentialsToken {
  readonly #tokenUrl: string;
  readonly #basic: string;
  #token?: string;
  #expiresAt = 0;
  #pending?: Promise<string>;

  constructor(authUrl: string, clientId: string, clientSecret: string) {
    this.#tokenUrl = `${authUrl.replace(/\/+$/, "")}/oauth/token`;
    this.#basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  }

  get(): Promise<string> {
    if (this.#token && Date.now() < this.#expiresAt - REFRESH_MARGIN_MS) return Promise.resolve(this.#token);
    this.#pending ??= this.#fetch().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  /** Drops the cached token, e.g. after the receiver rejected it. */
  invalidate(): void {
    this.#token = undefined;
  }

  async #fetch(): Promise<string> {
    const response = await fetch(this.#tokenUrl, {
      method: "POST",
      headers: {
        authorization: `Basic ${this.#basic}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) {
      throw new Error(`Token request to ${this.#tokenUrl} failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
    }
    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error(`Token response from ${this.#tokenUrl} has no access_token`);
    this.#token = json.access_token;
    this.#expiresAt = Date.now() + (json.expires_in ?? 0) * 1000;
    return this.#token;
  }
}
