/** The user-facing username contract inside one university. */
export const USERNAME_MINIMUM_LENGTH = 3;
export const USERNAME_MAXIMUM_LENGTH = 64;
/** Internal Better Auth keys include the immutable tenant slug namespace. */
export const AUTH_USERNAME_MAXIMUM_LENGTH = 160;
/** Bounds pre-auth lookup input, including the synthetic e-mail form. */
export const LOGIN_IDENTIFIER_MAXIMUM_LENGTH = 128;

export function isValidUsernameCharacters(value: string): boolean {
  return /^[a-z0-9._-]+$/.test(value);
}

/** Better Auth sees canonical tenant-scoped keys, not the local UI username. */
export const USERNAME_PLUGIN_OPTIONS = {
  minUsernameLength: USERNAME_MINIMUM_LENGTH,
  maxUsernameLength: AUTH_USERNAME_MAXIMUM_LENGTH,
  usernameValidator: (value: string) => /^[a-z0-9._-]+$/.test(value),
};
