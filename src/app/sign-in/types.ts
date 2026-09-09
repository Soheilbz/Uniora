export interface SignInLabels {
  tenant: string;
  tenantHint: string;
  tenantPlaceholder: string;
  tenantRequired: string;
  username: string;
  usernameHint: string;
  usernamePlaceholder: string;
  usernameRequired: string;
  password: string;
  passwordHint: string;
  passwordRequired: string;
  showPassword: string;
  hidePassword: string;
  capsLock: string;
  remember: string;
  rememberHint: string;
  submit: string;
  submitting: string;
  errorTitle: string;
  failed: string;
  tooManyAttempts: string;
  unreachable: string;
  forgotHint: string;
  passkey: string;
  passkeyFailed: string;
  sso: string;
  ssoFailed: string;
  ssoUnavailable: string;
}

export type SignInFieldErrors = { tenant?: string; username?: string; password?: string };
export type SsoProvider = { providerId: string; name: string; kind: string };
