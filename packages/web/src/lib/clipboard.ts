/**
 * Copies a text and says whether it worked.
 *
 * `navigator.clipboard` only exists in a secure context (https or localhost): a container opened over
 * plain http on a LAN address has none, so the fallback selects a throwaway field and uses the older
 * `execCommand('copy')`, which still works there.
 */
export async function copyText(text: string): Promise<boolean> {
  if ('clipboard' in navigator) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused (permissions policy, no focus): try the older way.
    }
  }

  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  try {
    field.select();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only way over plain http
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
