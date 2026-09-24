import React, { useState } from 'react';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  setPersistence, 
  browserSessionPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { Lock, Mail, UserPlus, LogIn, Eye, EyeOff, AlertCircle, Newspaper } from 'lucide-react';

interface AuthScreenProps {
  onSuccess?: () => void;
  onGuestLogin?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onSuccess, onGuestLogin }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [sessionOnly, setSessionOnly] = useState(true); // Default to requiring login each browser session
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError('이메일과 비밀번호를 모두 입력해 주세요.');
      return;
    }

    if (isSignUp && password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    if (password.length < 6) {
      setError('비밀번호는 최소 6자 이상이어야 합니다.');
      return;
    }

    setLoading(true);

    try {
      const persistenceType = sessionOnly ? browserSessionPersistence : browserLocalPersistence;
      await setPersistence(auth, persistenceType);

      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }

      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      console.error('Authentication error:', err);
      let msg = '인증 처리 중 오류가 발생했습니다.';
      if (err.code === 'auth/operation-not-allowed') {
        msg = '이메일/비밀번호 가입 기능이 Firebase 콘솔에서 활성화되지 않았습니다. Firebase 콘솔(Authentication > Sign-in method)에서 Email/Password 인증을 활성화해 주세요.';
      } else if (err.code === 'auth/email-already-in-use') {
        msg = '이미 가입된 이메일 주소입니다.';
      } else if (err.code === 'auth/invalid-email') {
        msg = '유효하지 않은 이메일 형식입니다.';
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        msg = '이메일 또는 비밀번호가 올바르지 않습니다.';
      } else if (err.code === 'auth/weak-password') {
        msg = '비밀번호가 너무 취약합니다. 6자 이상 입력해 주세요.';
      } else if (err.message) {
        msg = err.message;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex items-center justify-center p-4 font-sans relative overflow-hidden">
      {/* Editorial Decorative Background */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-700 via-indigo-600 to-blue-800" />
      <div className="absolute top-12 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-blue-100/50 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-white border border-slate-200/90 rounded-2xl shadow-xl p-8 relative z-10">
        {/* Header Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-50 text-blue-700 border border-blue-200 mb-4 shadow-xs">
            <Newspaper className="w-6 h-6 text-blue-700" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight font-serif">
            News Translation Assistant in Korean (NTAK)
          </h1>
          <p className="text-xs text-slate-500 mt-2 font-sans">
            {isSignUp ? '새 계정을 생성하여 정론 번역 데스크를 이용하세요' : '계정에 로그인하여 정론 번역 데스크를 이용하세요'}
          </p>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="mb-6 p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-red-700 text-xs leading-relaxed">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              이메일 주소
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600 transition-all"
              />
            </div>
          </div>

          {/* Password Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              비밀번호
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-10 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirm Password Input (Sign Up Only) */}
          {isSignUp && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                비밀번호 확인
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600 transition-all"
                />
              </div>
            </div>
          )}

          {/* Session Persistence Toggle */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="sessionOnly"
              checked={sessionOnly}
              onChange={(e) => setSessionOnly(e.target.checked)}
              className="w-4 h-4 rounded bg-slate-100 border-slate-300 text-blue-700 focus:ring-blue-600 cursor-pointer accent-blue-700"
            />
            <label htmlFor="sessionOnly" className="text-xs text-slate-600 cursor-pointer select-none">
              접속할 때마다 매번 로그인 필요 (세션 단위 유지)
            </label>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2.5 px-4 rounded-xl shadow-md shadow-blue-700/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm cursor-pointer"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : isSignUp ? (
              <>
                <UserPlus className="w-4 h-4" />
                <span>계정 생성하기</span>
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>로그인하기</span>
              </>
            )}
          </button>
        </form>

        {/* Toggle Sign In / Sign Up */}
        <div className="mt-6 pt-6 border-t border-slate-200 text-center">
          <p className="text-xs text-slate-500">
            {isSignUp ? '이미 계정이 있으신가요?' : '아직 계정이 없으신가요?'}
            {' '}
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError(null);
              }}
              className="text-blue-700 hover:text-blue-800 font-semibold underline underline-offset-4 ml-1 transition-colors cursor-pointer"
            >
              {isSignUp ? '로그인 페이지로' : '새 계정 만들기'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

