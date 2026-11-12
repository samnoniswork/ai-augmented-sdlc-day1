import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { Link, LinksService } from './links.service';

function httpUrl(control: AbstractControl): ValidationErrors | null {
  try {
    const url = new URL(String(control.value).trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? null : { httpUrl: true };
  } catch {
    return { httpUrl: true };
  }
}

function errorMessage(error: HttpErrorResponse): string {
  return typeof error.error?.error === 'string' && error.error.error.trim()
    ? error.error.error
    : 'Unable to reach the server. Please try again.';
}

@Component({
  selector: 'app-root',
  imports: [ReactiveFormsModule],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.component.css'
})
export class AppComponent {
  private readonly service = inject(LinksService);
  private readonly destroyRef = inject(DestroyRef);
  private requestNumber = 0;

  readonly url = new FormControl('', { nonNullable: true, validators: [Validators.required, httpUrl] });
  readonly form = new FormGroup({ url: this.url });
  readonly links = signal<Link[]>([]);
  readonly loading = signal(true);
  readonly listError = signal('');
  readonly submitting = signal(false);
  readonly submitError = signal('');
  readonly result = signal<Link | null>(null);

  constructor() {
    this.refresh();
  }

  refresh(): void {
    const request = ++this.requestNumber;
    this.loading.set(true);
    this.listError.set('');
    this.service.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: links => {
        if (request === this.requestNumber) {
          this.links.set(links);
          this.loading.set(false);
        }
      },
      error: (error: HttpErrorResponse) => {
        if (request === this.requestNumber) {
          this.listError.set(errorMessage(error));
          this.loading.set(false);
        }
      }
    });
  }

  submit(): void {
    if (this.submitting()) return;
    this.url.markAsTouched();
    if (this.url.invalid) return;

    this.submitting.set(true);
    this.submitError.set('');
    this.result.set(null);
    this.service.create(this.url.value.trim()).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.submitting.set(false))
    ).subscribe({
      next: link => {
        this.result.set(link);
        this.url.reset();
        this.refresh();
      },
      error: (error: HttpErrorResponse) => this.submitError.set(errorMessage(error))
    });
  }
}
