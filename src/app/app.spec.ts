import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { EMPTY_COLLECTION } from './core/collection';
import { CardCatalogRepository, CollectionRepository } from './core/repositories';
import { FirebaseAuthService } from './core/firebase-auth';
import { FirebaseCloudSync } from './core/firebase-cloud-sync';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        {
          provide: CardCatalogRepository,
          useValue: { load: async () => ({ species: [], cards: [] }) },
        },
        {
          provide: CollectionRepository,
          useValue: { load: () => EMPTY_COLLECTION, save: () => undefined },
        },
        {
          provide: FirebaseAuthService,
          useValue: {
            _user: signal(null),
            _loading: signal(false),
            _error: signal(''),
            clearError: () => undefined,
            start: async () => undefined,
            signInWithGoogle: async () => undefined,
            signOut: async () => undefined,
          },
        },
        {
          provide: FirebaseCloudSync,
          useValue: {
            _status: signal('local'),
            _error: signal(''),
            start: () => undefined,
            retry: () => undefined,
            dismissError: () => undefined,
          },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render collection navigation', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('nav')?.textContent).toContain('Pokédex');
    expect(compiled.textContent).toContain('Mis álbumes');
  });
});
