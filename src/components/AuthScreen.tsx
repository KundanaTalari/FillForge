import React, { useState } from 'react';
import { FileText, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { signIn, signUp, User } from '../services/api';

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = mode === 'signin'
        ? await signIn(email, password)
        : await signUp(name, email, password);
      onAuthenticated(user);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Unable to continue. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-5 text-slate-900">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 sm:p-9 shadow-xl shadow-slate-900/5">
        <div className="flex items-center gap-3 mb-7">
          <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white grid place-items-center shadow-sm">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-xl">FillForge</h1>
            <p className="text-xs text-slate-500">Type once. Fill everywhere.</p>
          </div>
        </div>

        <h2 className="text-2xl font-bold">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {mode === 'signin' ? 'Sign in to manage your document templates.' : 'Start creating filled documents in seconds.'}
        </p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          {mode === 'signup' && (
            <label className="block text-sm font-semibold text-slate-700">
              Name
              <span className="relative mt-1.5 block"><UserRound className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
              </span>
            </label>
          )}
          <label className="block text-sm font-semibold text-slate-700">
            Email
            <span className="relative mt-1.5 block"><Mail className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
              <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
            </span>
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Password
            <span className="relative mt-1.5 block"><LockKeyhole className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
              <input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
            </span>
          </label>
          {error && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          <button disabled={submitting} className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60">
            {submitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          {mode === 'signin' ? 'New to FillForge?' : 'Already have an account?'}{' '}
          <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }} className="font-bold text-indigo-600 hover:text-indigo-800">
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </section>
    </main>
  );
}
