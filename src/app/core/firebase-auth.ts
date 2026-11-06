import { Injectable, signal } from '@angular/core';
import { FIREBASE_CONFIG } from './firebase-config';

export interface FirebaseUser {
  readonly uid: string;
  readonly email: string | null;
}

@Injectable({ providedIn: 'root' })
export class FirebaseAuthService {
  private authPromise: Promise<import('firebase/auth').Auth> | null = null;
  public readonly _user = signal<FirebaseUser | null>(null);
  public readonly _loading = signal(true);
  public readonly _error = signal('');

  public async start(): Promise<void> {
    await this.initialize();
  }

  public async signInWithGoogle(): Promise<void> {
    this._error.set('');
    try {
      const [auth, authSdk] = await Promise.all([this.authInstance(), import('firebase/auth')]);
      await authSdk.signInWithPopup(auth, new authSdk.GoogleAuthProvider());
    } catch (error) {
      this._error.set(this.describeError(error, 'No se pudo iniciar sesión con Google.'));
    }
  }

  public async signOut(): Promise<void> {
    this._error.set('');
    try {
      const [auth, authSdk] = await Promise.all([this.authInstance(), import('firebase/auth')]);
      await authSdk.signOut(auth);
    } catch (error) {
      this._error.set(this.describeError(error, 'No se pudo cerrar la sesión.'));
    }
  }

  public clearError(): void {
    this._error.set('');
  }

  private async authInstance(): Promise<import('firebase/auth').Auth> {
    this.authPromise ??= (async () => {
      const [{ getApp, getApps, initializeApp }, authSdk] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
      ]);
      const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
      const auth = authSdk.getAuth(app);
      authSdk.onAuthStateChanged(
        auth,
        (user) => {
          this._user.set(user ? { uid: user.uid, email: user.email } : null);
          this._loading.set(false);
          this._error.set('');
        },
        () => {
          this._user.set(null);
          this._loading.set(false);
          this._error.set(
            'No se pudo restaurar la sesión de Firebase. La colección local sigue disponible.',
          );
        },
      );
      return auth;
    })();
    return this.authPromise;
  }

  private async initialize(): Promise<void> {
    try {
      await this.authInstance();
    } catch (error) {
      this._loading.set(false);
      this._error.set(this.describeError(error, 'No se pudo inicializar Firebase Auth.'));
    }
  }

  private describeError(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return `${fallback} ${error.message}`;
    return fallback;
  }
}
