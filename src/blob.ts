export interface BlobFolder {
  origin: string;
  container: string;
  prefix: string;
}

export const BLOB_FOLDER_RULE =
  'must be the https:// URL of a folder in an Azure Blob Storage container, such as https://<account>.blob.core.windows.net/<container>/<path>/, without a query string. Put the SAS in NEO_BLOB_SAS or remoteLanes.sas.';

export function parseBlobFolder(url: string): BlobFolder {
  let parsed: URL;
  let segments: string[];
  try {
    parsed = new URL(url);
    segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new Error(BLOB_FOLDER_RULE);
  }
  const [container, ...rest] = segments;
  if (parsed.protocol !== 'https:' || !container || parsed.search || parsed.hash) throw new Error(BLOB_FOLDER_RULE);
  return { origin: parsed.origin, container, prefix: rest.length ? `${rest.join('/')}/` : '' };
}

export function maskSas(text: string): string {
  return text.replace(/([?&]sig=)[^&#\s"'<>]+/gi, '$1[redacted]');
}

function decodeXml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

async function blobFetch(url: string, folder: BlobFolder): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    const access = response.status === 401 || response.status === 403 ? '. Check that the SAS is valid, not expired, and has read (r) and list (l) permissions.' : '';
    throw new Error(`Azure Blob Storage answered ${response.status} ${response.statusText} for ${folder.origin}/${folder.container}${access}`);
  }
  return response;
}

export async function listBlobNames(folder: BlobFolder, sas: string): Promise<string[]> {
  const names: string[] = [];
  let marker = '';
  do {
    const page = `${folder.origin}/${folder.container}?restype=container&comp=list&prefix=${encodeURIComponent(folder.prefix)}&${sas}`;
    const xml = await (await blobFetch(marker ? `${page}&marker=${encodeURIComponent(marker)}` : page, folder)).text();
    for (const [, name] of xml.matchAll(/<Name>([^<]*)<\/Name>/g)) names.push(decodeXml(name));
    marker = decodeXml(/<NextMarker>([^<]+)<\/NextMarker>/.exec(xml)?.[1] ?? '');
  } while (marker);
  return names;
}

export async function downloadBlobJson(folder: BlobFolder, sas: string, name: string): Promise<unknown> {
  const response = await blobFetch(`${folder.origin}/${folder.container}/${name.split('/').map(encodeURIComponent).join('/')}?${sas}`, folder);
  return response.json();
}
