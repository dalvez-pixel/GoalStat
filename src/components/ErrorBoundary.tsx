import { AlertTriangle, RefreshCw } from 'lucide-react';
import React from 'react';
import type { FirestoreErrorInfo } from '../lib/firebase.ts';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  firestoreDetail: FirestoreErrorInfo | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      message: '',
      firestoreDetail: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let firestoreDetail: FirestoreErrorInfo | null = null;
    let message = 'Ocurrió un error inesperado al sincronizar con la nube.';

    try {
      const parsed = JSON.parse(error.message) as Partial<FirestoreErrorInfo>;
      if (parsed && typeof parsed.error === 'string' && typeof parsed.operationType === 'string') {
        firestoreDetail = parsed as FirestoreErrorInfo;
        if (parsed.error.toLowerCase().includes('permission')) {
          message =
            'No se pudo completar la operación en Firestore por falta de permisos o sesión no verificada.';
        } else {
          message = 'Se produjo un error al sincronizar tus datos con Cloud Firestore.';
        }
      } else if (error.message) {
        message = error.message;
      }
    } catch {
      if (error.message) {
        message = error.message;
      }
    }

    return {
      hasError: true,
      message,
      firestoreDetail,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ErrorBoundary capturó un error:', error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, message: '', firestoreDetail: null });
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-[#090909] text-slate-900 dark:text-slate-100">
        <div className="glass-panel max-w-lg w-full rounded-2xl border border-[#FF3B4B]/30 p-6 space-y-4 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-[#FF3B4B]/15 text-[#FF3B4B] shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="space-y-1 min-w-0">
              <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50">
                Error de sincronización en LambdaQuant
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300">{this.state.message}</p>
            </div>
          </div>

          {this.state.firestoreDetail && (
            <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100/80 dark:bg-white/[0.04] p-3.5 text-xs font-mono space-y-1 text-slate-700 dark:text-slate-300">
              <div>
                <span className="text-slate-500 dark:text-slate-400">Operación: </span>
                <span>{this.state.firestoreDetail.operationType}</span>
              </div>
              {this.state.firestoreDetail.path && (
                <div className="truncate">
                  <span className="text-slate-500 dark:text-slate-400">Ruta: </span>
                  <span>{this.state.firestoreDetail.path}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-slate-900 text-white hover:bg-slate-800 dark:bg-[#ABF43F] dark:text-[#090909] dark:hover:bg-[#bbf85f] transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Recargar aplicación</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
