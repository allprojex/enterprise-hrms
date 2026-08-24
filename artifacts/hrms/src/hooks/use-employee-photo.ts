import { useEffect, useState } from 'react';
import { getRemoveEmployeeProfilePictureUrl, getRemoveMyEmployeeProfilePictureUrl } from '@workspace/api-client-react';
import { getStoredToken } from '@/lib/auth';

async function fetchObjectUrl(url: string): Promise<string | null> {
  const token = getStoredToken();
  try {
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    // A network failure just means "no picture to show" — never an
    // unhandled rejection that would otherwise surface in the console.
    return null;
  }
}

/**
 * Employee profile pictures are served from an authenticated endpoint — a
 * plain <img src> can't attach the Bearer token, so this fetches the bytes
 * manually and hands the caller an object URL. Shared by the Employee
 * Detail page, the Employee directory list, and (via useMyProfilePhoto
 * below) every "my own avatar" surface, so there is exactly one fetch/
 * object-URL implementation for this pattern.
 */
export function useEmployeePhoto(organizationId: number, employeeId: number, hasPicture: boolean) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPicture || !organizationId || !employeeId) return;

    let objectUrl: string | null = null;
    let cancelled = false;

    (async () => {
      const url = await fetchObjectUrl(getRemoveEmployeeProfilePictureUrl(organizationId, employeeId));
      if (cancelled || !url) return;
      objectUrl = url;
      setSrc(url);
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [organizationId, employeeId, hasPicture]);

  return hasPicture ? src : null;
}

/** Same as useEmployeePhoto, but for the logged-in caller's own picture (self-service, no employeeId needed). */
export function useMyProfilePhoto(hasPicture: boolean) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPicture) return;

    let objectUrl: string | null = null;
    let cancelled = false;

    (async () => {
      const url = await fetchObjectUrl(getRemoveMyEmployeeProfilePictureUrl());
      if (cancelled || !url) return;
      objectUrl = url;
      setSrc(url);
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [hasPicture]);

  return hasPicture ? src : null;
}
