import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a date string to the news agency standard: MM. DD. HH:MM
 */
export function formatPublicationTime(date: Date): string {
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  const h = date.getHours().toString().padStart(2, '0');
  const min = date.getMinutes().toString().padStart(2, '0');
  return `${m}. ${d}. ${h}:${min}`;
}

/**
 * Converts a date to KST and formats it.
 */
export function formatKSTTime(date: Date): string {
  // Asia/Seoul is UTC+9
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstDate = new Date(date.getTime() + kstOffset);
  return formatPublicationTime(kstDate);
}
