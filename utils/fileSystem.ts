

/**
 * Utility functions for the File System Access API.
 * Allows saving files directly to the user's hard drive.
 */

export async function verifyPermission(fileHandle: FileSystemHandle, readWrite: boolean = false) {
  const options: any = {};
  if (readWrite) {
    options.mode = 'readwrite';
  }
  // Check if permission was already granted. If so, return true.
  if ((await (fileHandle as any).queryPermission(options)) === 'granted') {
    return true;
  }
  // Request permission. If the user grants permission, return true.
  if ((await (fileHandle as any).requestPermission(options)) === 'granted') {
    return true;
  }
  return false;
}

export async function saveFileToFolder(dirHandle: FileSystemDirectoryHandle, filename: string, data: Blob | string) {
  try {
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
    return true;
  } catch (error) {
    console.error(`Error saving file ${filename}:`, error);
    throw error;
  }
}

export async function readFileFromFolder(dirHandle: FileSystemDirectoryHandle, filename: string): Promise<Blob> {
  try {
    const fileHandle = await dirHandle.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return file; // File is a specialized Blob
  } catch (error) {
    console.error(`Error reading file ${filename}:`, error);
    throw error;
  }
}

export async function getFileUrl(dirHandle: FileSystemDirectoryHandle, filename: string): Promise<string> {
    const blob = await readFileFromFolder(dirHandle, filename);
    return URL.createObjectURL(blob);
}
