import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { Link } from './links.service';

describe('AppComponent', () => {
  let http: HttpTestingController;
  const link: Link = {
    code: 'abc123', url: 'https://example.com/', shortUrl: 'http://localhost:3000/abc123',
    hits: 0, createdAt: '2026-01-01T00:00:00.000Z'
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()]
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('rejects invalid URLs without submitting', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    http.expectOne('/api/links').flush([]);
    for (const value of ['', 'not a URL', 'ftp://example.com']) {
      app.url.setValue(value);
      app.submit();
      expect(app.url.invalid).toBeTrue();
    }
    http.expectNone(request => request.method === 'POST');
  });

  it('prevents duplicate submissions and refreshes the list on success', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    http.expectOne('/api/links').flush([]);
    app.url.setValue(' https://example.com/ ');
    app.submit();
    app.submit();
    const post = http.expectOne(request => request.method === 'POST' && request.url === '/api/links');
    expect(post.request.body).toEqual({ url: 'https://example.com/' });
    expect(app.submitting()).toBeTrue();
    post.flush(link, { status: 201, statusText: 'Created' });
    expect(app.result()).toEqual(link);
    expect(app.submitting()).toBeFalse();
    http.expectOne('/api/links').flush([link]);
    expect(app.links()).toEqual([link]);
  });

  it('shows server and network errors and permits retry', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    http.expectOne('/api/links').flush('down', { status: 503, statusText: 'Unavailable' });
    expect(app.listError()).toContain('Unable to reach');
    app.url.setValue('https://example.com');
    app.submit();
    http.expectOne(request => request.method === 'POST').flush(
      { error: 'Invalid URL' }, { status: 400, statusText: 'Bad Request' }
    );
    expect(app.submitError()).toBe('Invalid URL');
    expect(app.submitting()).toBeFalse();
    app.submit();
    http.expectOne(request => request.method === 'POST').error(new ProgressEvent('error'));
    expect(app.submitError()).toContain('Unable to reach');
  });

  it('keeps the newest list when requests finish out of order', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    const oldRequest = http.expectOne('/api/links');
    app.refresh();
    http.expectOne('/api/links').flush([link]);
    oldRequest.flush([]);
    expect(app.links()).toEqual([link]);
  });

  it('submits through the Shorten button and renders the refreshed table', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    http.expectOne('/api/links').flush([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No links yet');
    const rendered = fixture.nativeElement as HTMLElement;
    const input = rendered.querySelector('input')!;
    input.value = link.url;
    input.dispatchEvent(new Event('input'));
    rendered.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    http.expectOne(request => request.method === 'POST').flush(link);
    http.expectOne('/api/links').flush([link]);
    fixture.detectChanges();
    expect(rendered.querySelector('.success')?.textContent).toContain(link.shortUrl);
    expect(rendered.querySelector('tbody')?.textContent).toContain(link.code);
    expect(rendered.querySelector('tbody')?.textContent).toContain(link.url);
  });

  it('handles native form submission without navigation and shows validation errors', () => {
    const fixture = TestBed.createComponent(AppComponent);
    http.expectOne('/api/links').flush([]);
    fixture.detectChanges();
    const rendered = fixture.nativeElement as HTMLElement;
    const event = new Event('submit', { bubbles: true, cancelable: true });
    rendered.querySelector('form')!.dispatchEvent(event);
    fixture.detectChanges();
    expect(event.defaultPrevented).toBeTrue();
    expect(rendered.querySelector('#url-error')?.textContent).toContain('Enter a valid');
    http.expectNone(request => request.method === 'POST');
  });
});
