const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCredentials(email: string, password: string) {
  const errors: { email?: string; password?: string } = {};
  if (!email.trim()) errors.email = 'Escribí tu correo.';
  else if (!emailPattern.test(email.trim())) errors.email = 'Revisá el formato del correo.';
  if (!password) errors.password = 'Escribí tu contraseña.';
  return errors;
}

