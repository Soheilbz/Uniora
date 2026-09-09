export function isoDaysFromToday(days: number): string {
  const when = new Date();
  when.setDate(when.getDate() + days);
  return when.toISOString().slice(0, 10);
}

export function nationalId(seed: number): string {
  const body = `00${String(seed).padStart(8, "0")}`.slice(0, 9);
  let sum = 0;
  for (let position = 0; position < 9; position += 1) {
    sum += Number(body[position]) * (10 - position);
  }
  const remainder = sum % 11;
  return `${body}${remainder < 2 ? remainder : 11 - remainder}`;
}
