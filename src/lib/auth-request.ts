import { cookies } from 'next/headers';
import { sessionUser, SESSION_COOKIE } from './auth';
export async function currentUser() { return sessionUser((await cookies()).get(SESSION_COOKIE)?.value); }
