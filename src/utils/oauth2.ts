import crypto from 'crypto';
// import {env} from '../env';
// import {boundMethod} from 'autobind-decorator';
import {OpenIdConfig, AccessToken, TokenResponseBody} from '../types';
import {
  saveToLocalStorage,
  getFromLocalStorage,
  clearFromLocalStorage,
  // isDev,
} from '.';

const OPENID_CONFIG_PATH = '.well-known/openid-configuration.json';
// const subjectId = isDev ? env.DEV_OAUTH2_SUBJECT_ID : env.OAUTH2_SUBJECT_ID;

interface Oauth2Options {
  webAuthFlowOptions: Partial<chrome.identity.WebAuthFlowOptions>;
  clientAuthParams: string[][];
}

type Oauth2OptionsArgument = Partial<Oauth2Options>;

const DEFAULT_OPTIONS: Oauth2Options = {
  webAuthFlowOptions: {
    interactive: true,
  },
  clientAuthParams: [],
};

export class Oauth2 {
  // Prettier complains if this is not here

  /**
   * Fetches an OpenId configuration from a given domain, which contains details
   * used to make an oauth2 request from a given service, such as the authorization
   * url or token url.
   *
   * @param domain - The domain which you want to fetch the config from.
   */

  clientId: string;
  domain: string;
  options: Oauth2Options;
  config?: OpenIdConfig;

  public constructor(
    clientId: string,
    domain: string,
    options: Oauth2OptionsArgument,
  ) {
    this.clientId = clientId;
    this.domain = domain;
    this.options = {...DEFAULT_OPTIONS, ...options};
  }

  /**
   * Request a new oauth2 access token from the clientId and clientScope specified in the constructor
   */
  public authenticate(params: string[][] = []): Promise<AccessToken> {
    const {clientId} = this;
    const {clientAuthParams} = this.options;
    return this.getValidAccessTokenAndSave(
      clientId,
      [...clientAuthParams, ...params],
      this.getNewAccessToken,
    );
  }

  public async revokeAuthToken() {
    const token = await this.getAccessTokenFromStorage(this.clientId);
    console.log(token);
    // console.log(token);
    // console.log(this.clientId);
    // const urlApp = `https://identity.myshopify.io/oauth/revoke?token=${
    //   token!.refreshToken
    // }&client_id=${subjectId}`;

    // const responseApp = await fetch(urlApp, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/x-www-form-urlencoded',
    //   },
    // });

    // const tokenCore = this.getSubjectAccessToken(subjectId, []);
    // const urlCore = `https://identity.myshopify.io/oauth/revoke?token=${tokenCore}&client_id=${subjectId}`;
    // const responseCore = await fetch(urlCore, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/x-www-form-urlencoded',
    //   },
    // });
    // console.log(responseApp);
    // console.log(responseCore);
    this.deleteAccessToken();
    const config = await this.getConfig();
    console.log(token!.idToken);
    const url = new URL(
      `${config.end_session_endpoint}?id_token_hint=${token!.idToken}`,
    );
    // const resp = await fetch(url.href, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/x-www-form-urlencoded',
    //   },
    // });
    console.log(url.href);
    const resp = await fetch(url.href);
    console.log(resp);
    this.deleteAccessToken();
  }

  public async getUserInfo() {
    const config = await this.getConfig();
    const token = await this.getAccessTokenFromStorage(this.clientId);
    const url = new URL(config.userinfo_endpoint);
    console.log(token!.accessToken);
    const response = await fetch(url.href, {
      headers: {Authorization: `Bearer ${token!.accessToken}`},
    });
    // const resp = await fetch(url.href);
    console.log(await response.json());
  }

  /**
   * Get a valid access token for the given application via storage, refresh
   * token, or via token exchange using a valid client token.
   *
   * @param subjectId - The Id of the application we want to exchange a token with
   * @param scope - The scope we want for the token if we need to request a new one
   */
  public getSubjectAccessToken(
    subjectId: string,
    params: string[][],
  ): Promise<AccessToken> {
    return this.getValidAccessTokenAndSave(
      subjectId,
      params,
      this.exchangeToken,
    );
  }

  public async hasValidAccessToken(): Promise<Boolean> {
    const token = await this.getAccessTokenFromStorage(this.clientId);
    if (typeof token === 'undefined') {
      return false;
    }
    return true;
  }

  public deleteAccessToken() {
    clearFromLocalStorage();
  }

  /**
   * Try to get the associated from storage, or from refresh token, or request a
   * new token using the provided callback method.
   *
   * @param id - Unique ID of the application we're getting a token for
   * @param scope - The scope of the token
   * @param cb - A callback which will be used to request a new token if it's not available in storage or via refresh token
   */
  private async getValidAccessTokenAndSave(
    id: string,
    params: string[][],
    cb: (uuid: string, params: string[][]) => Promise<AccessToken>,
  ): Promise<AccessToken> {
    let token = await this.getAccessTokenFromStorage(id);
    // If no access token then start new access token flow
    if (typeof token === 'undefined') {
      token = await cb.call(this, id, params);
      console.log(token);
    } else if (this.isAccessTokenExpired(token)) {
      // If there is an access token but its expired
      if (token.refreshToken) {
        // There is a refresh token
        token = await this.refreshClientAccessToken(id, token.refreshToken);
      } else {
        // No refresh token so request a new access token
        token = await cb.call(this, id, params);
      }
    }

    return this.saveAccessTokenToStorage(id, token);
  }

  /**
   * Request a new valid access token for the given application id using a
   * refresh token.
   *
   * @param id - ID of the given application
   * @param refreshToken - The refresh token included in the last valid token we had
   */
  private async refreshClientAccessToken(id: string, refreshToken: string) {
    const config = await this.getConfig();
    const url = new URL(config.token_endpoint);

    url.search = new URLSearchParams([
      ['grant_type', 'refresh_token'],
      ['refresh_token', refreshToken],
      ['client_id', id],
    ]).toString();

    const response = await fetch(url.href, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (response.ok) return this.normalizeTokenResponse(response);

    throw Error(response.statusText);
  }

  /**
   *  Request a new access token for the given application, presenting a login
   *  prompt if required.
   *
   * @param id - The id of the application we're requesting a token for
   * @param scope - The scope of the access token we're requesting
   */
  private async getNewAccessToken(id: string, params: string[][]) {
    const {
      secret: codeVerifier,
      hashed: codeChallenge,
    } = this.generateRandomChallengePair();
    const config = await this.getConfig();
    const url = new URL(config.authorization_endpoint);

    url.search = new URLSearchParams([
      ['redirect_uri', this.getRedirectURL()],
      ['client_id', id],
      ['code_challenge', codeChallenge],
      ['code_challenge_method', 'S256'],
      ['response_type', 'code'],
      ...params,
    ]).toString();

    const resultUrl = await this.launchWebAuthFlow(url.href);
    // console.log(url.href);
    const code = this.extractCode(resultUrl);
    // console.log(resultUrl);
    // console.log(code);
    return this.exchangeCodeForToken(code, codeVerifier);
  }

  /**
   * Check an access token to see if it has expired yet.
   *
   * @param param0 - An object of type AccessToken
   */
  private isAccessTokenExpired({
    accessTokenDate,
    expiresIn,
  }: AccessToken): boolean {
    return new Date().valueOf() - accessTokenDate > expiresIn * 1000;
  }

  private async getConfig(): Promise<OpenIdConfig> {
    const {domain, config} = this;
    const url = `https://${domain}/${OPENID_CONFIG_PATH}`;

    if (typeof config === 'undefined') {
      const result = await fetch(url);
      if (!result.ok) throw Error(result.statusText);
      return (this.config = await result.json());
    } else {
      return config;
    }
  }

  /**
   * Check local storage to see if we have a token saved.
   *
   * @param id - The application id associated to the token we want to get
   */
  private async getAccessTokenFromStorage(
    id: string,
  ): Promise<AccessToken | undefined> {
    const data = await getFromLocalStorage(id);
    if (typeof data === 'undefined') {
      return data;
    }

    return JSON.parse(data);
  }

  /**
   * Save an access token to local storage
   * @param id - The application id associated to the token we want to save
   * @param data - An AccessToken
   */
  private async saveAccessTokenToStorage(id: string, data: AccessToken) {
    await saveToLocalStorage(id, JSON.stringify(data));
    return data;
  }

  /**
   * Exchange a valid access token for a new access token for another Identity application
   *
   * @param accessToken - A valid access token
   * @param audienceId - The unique ID of the application you want a new access token from
   */
  private async exchangeToken(
    applicationId: string,
    params: string[][],
  ): Promise<AccessToken> {
    const {clientId} = this;
    const config = await this.getConfig();
    const {accessToken} = await this.authenticate();
    const url = new URL(config.token_endpoint);

    url.search = new URLSearchParams([
      ['grant_type', 'urn:ietf:params:oauth:grant-type:token-exchange'],
      ['client_id', clientId],
      ['audience', applicationId],
      ['subject_token', accessToken],
      ['subject_token_type', 'urn:ietf:params:oauth:token-type:access_token'],
      ...params,
    ]).toString();

    const response = await fetch(url.href, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (response.ok) return this.normalizeTokenResponse(response);

    throw Error(response.statusText);
  }

  /**
   * Convert the response from the token endpoint into a valid AccessToken object
   *
   * @param response - A successful response from the oauth/token endpoint
   */
  private async normalizeTokenResponse(
    response: Response,
  ): Promise<AccessToken> {
    const responseDateHeader = response.headers.get('Date');
    const accessTokenDate = responseDateHeader
      ? new Date(responseDateHeader).valueOf()
      : new Date().valueOf();
    const body: TokenResponseBody = await response.json();
    console.log(body);

    return {
      accessToken: body.access_token,
      accessTokenDate,
      expiresIn: body.expires_in,
      scope: body.scope,
      tokenType: body.token_type,
      issuedTokenType: body.issued_token_type,
      refreshToken: body.refresh_token,
      idToken: body.id_token,
    };
  }

  /**
   * Use Chrome's Identity API to get an oauth2 authorization code. This can be
   * optionally done via an interactive popup window that presents a login view.
   *
   * @param url - The oauth2 authorization URL
   */
  private launchWebAuthFlow(
    url: string,
    options: Partial<chrome.identity.WebAuthFlowOptions> = {},
  ): Promise<string> {
    const {webAuthFlowOptions} = this.options;
    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        {...webAuthFlowOptions, ...options, url},
        callbackURL => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }

          return resolve(callbackURL);
        },
      );
    });
  }

  /**
   * Exchange an authorization code for an access token for application clientId
   * specified in the constructor
   *
   * @param code - An authorization code that is recieved from the RedirectURI of a successful login/authorization flow.
   * @param verifier - The code verifier code associated to the code challenge sent during the authorization flow.
   */
  private async exchangeCodeForToken(
    code: string,
    verifier: string,
  ): Promise<AccessToken> {
    const {clientId} = this;
    const config = await this.getConfig();
    const url = new URL(config.token_endpoint);

    url.search = new URLSearchParams([
      ['redirect_uri', this.getRedirectURL()],
      ['grant_type', 'authorization_code'],
      ['code_verifier', verifier],
      ['client_id', clientId],
      ['code', code],
    ]).toString();
    // console.log(url.href);
    const response = await fetch(url.href, {method: 'POST'});
    console.log(response);

    if (response.ok) return this.normalizeTokenResponse(response);

    throw Error(response.statusText);
  }

  /**
   * After a successful authorization, the page is redirected. The URL of the
   * redirected page contains the authorization code. This method extracts that
   * code from the provided redirect URL.
   *
   * @param redirectURL - The redirectURL provided after authorization
   */
  private extractCode(redirectURL: string): string {
    const {searchParams} = new URL(redirectURL);
    const error = searchParams.get('error');
    const code = searchParams.get('code');

    if (error) {
      throw new Error(searchParams.get('error_description') || error);
    }

    if (!code) {
      throw new Error('RedirectURI code does not exist');
    }

    return code;
  }

  private generateRandomChallengePair() {
    const secret = this.base64URLEncode(crypto.randomBytes(32));
    const hashed = this.base64URLEncode(this.sha256(secret));
    return {secret, hashed};
  }

  private getRedirectURL() {
    return chrome.identity.getRedirectURL('auth0');
  }

  private base64URLEncode(str: Buffer) {
    return str
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/[=]/g, '');
  }

  private sha256(buffer: string) {
    return crypto
      .createHash('sha256')
      .update(buffer)
      .digest();
  }
}
