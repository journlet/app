// Hand a file to the browser.
//
// Its own module because two things now download: the Markdown export and the
// backup. The object URL is revoked immediately after the click, which is safe —
// the browser has already taken its reference by then — and skipping it leaks the
// whole blob for the life of the document, which for a journal-sized backup is
// not nothing.

export const download = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
