// Rejects the passwords attackers try first. Length is the main defence (min 10, max 200);
// this list blocks the common long ones that still appear in every credential-stuffing dump.
const COMMON = new Set(
  `password1 password12 password123 password1234 password12345 passw0rd123 qwerty1234 qwertyuiop qwerty12345
  1234567890 12345678910 0987654321 1q2w3e4r5t 1qaz2wsx3edc iloveyou123 welcome123 welcome1234 letmein123
  admin12345 administrator changeme123 trustno1234 football123 baseball123 sunshine123 princess123 dragon1234
  monkey12345 superman123 starwars123 abc1234567 abcdefghij aaaaaaaaaa 1111111111 0000000000 qwertyqwerty
  zaq12wsxcde asdfghjkl1 asdfghjkl123 computer123 internet123 password!1 password@123 p@ssw0rd123 p@ssword123
  india12345 india@1234 bharat1234 mumbai1234 delhi12345 cricket123 pulsewatch pulsewatch1 pulsewatch123`.split(/\s+/)
);

export const checkPassword = (password, { email, name } = {}) => {
  const pw = String(password || '');
  if (pw.length < 10) return 'Password must be at least 10 characters long';
  if (pw.length > 200) return 'Password is too long';
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common — choose something less guessable';
  if (/^(.)\1+$/.test(pw)) return 'Password cannot be a single repeated character';
  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) return 'Password must not contain your email address';
  const first = String(name || '').trim().split(/\s+/)[0]?.toLowerCase();
  if (first && first.length >= 4 && lower === `${first}123456`) return 'Password is too easy to guess';
  return null;
};
