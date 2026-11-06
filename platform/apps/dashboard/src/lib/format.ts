export const formatDateTime = (value: string) => new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta",
}).format(new Date(value));

export const labelize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export const confidencePercent = (value?: number) => value === undefined ? "—" : `${Math.round(value * 100)}%`;
