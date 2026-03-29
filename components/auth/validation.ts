export type LoginFormValues = {
  email: string;
  password: string;
  rememberMe: boolean;
};

export type RegisterFormValues = {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  favoriteTeam: string;
  acceptTerms: boolean;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const PASSWORD_HAS_LETTER = /[A-Za-z]/;
const PASSWORD_HAS_NUMBER = /\d/;

type LoginField = keyof Pick<LoginFormValues, "email" | "password">;
type RegisterField = keyof Pick<
  RegisterFormValues,
  "username" | "email" | "password" | "confirmPassword" | "favoriteTeam" | "acceptTerms"
>;

export type LoginErrors = Partial<Record<LoginField, string>>;
export type RegisterErrors = Partial<Record<RegisterField, string>>;

export function validateLogin(values: LoginFormValues): LoginErrors {
  const errors: LoginErrors = {};

  if (!values.email.trim()) {
    errors.email = "Email is required.";
  } else if (!EMAIL_REGEX.test(values.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (!values.password) {
    errors.password = "Password is required.";
  } else if (values.password.length < 8) {
    errors.password = "Password must be at least 8 characters.";
  }

  return errors;
}

export function validateRegister(values: RegisterFormValues): RegisterErrors {
  const errors: RegisterErrors = {};
  const username = values.username.trim();
  const email = values.email.trim();

  if (!username) {
    errors.username = "Username is required.";
  } else if (username.length < 3) {
    errors.username = "Username must be at least 3 characters.";
  } else if (username.length > 30) {
    errors.username = "Username must be 30 characters or fewer.";
  } else if (!USERNAME_REGEX.test(username)) {
    errors.username = "Username can only include letters, numbers, and underscores.";
  }

  if (!email) {
    errors.email = "Email is required.";
  } else if (!EMAIL_REGEX.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!values.password) {
    errors.password = "Password is required.";
  } else if (values.password.length < 8) {
    errors.password = "Password must be at least 8 characters.";
  } else if (!PASSWORD_HAS_LETTER.test(values.password) || !PASSWORD_HAS_NUMBER.test(values.password)) {
    errors.password = "Password must include at least one letter and one number.";
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Confirm your password.";
  } else if (values.password !== values.confirmPassword) {
    errors.confirmPassword = "Passwords do not match.";
  }

  if (!values.acceptTerms) {
    errors.acceptTerms = "You must accept the community guidelines to continue.";
  }

  return errors;
}
