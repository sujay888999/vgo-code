import { create } from 'zustand';
import Cookies from 'js-cookie';
import { userApi } from './api';

const TOKEN_KEY = 'token';
const LANGUAGE_KEY = 'vgo-language';

function readToken() {
  if (typeof window === 'undefined') {
    return Cookies.get(TOKEN_KEY);
  }

  return Cookies.get(TOKEN_KEY) || window.localStorage.getItem(TOKEN_KEY) || undefined;
}

function persistToken(token: string) {
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:';

  Cookies.set(TOKEN_KEY, token, {
    expires: 7,
    path: '/',
    sameSite: 'lax',
    secure,
  });

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(TOKEN_KEY, token);
  }
}

function clearToken() {
  Cookies.remove(TOKEN_KEY, { path: '/' });

  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

interface User {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
  balance?: number;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setToken: (token: string) => void;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export type AppLanguage = 'zh' | 'en';

interface LanguageState {
  language: AppLanguage;
  hydrated: boolean;
  setLanguage: (language: AppLanguage) => void;
  hydrateLanguage: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  setUser: (user) =>
    set({
      user,
      isAuthenticated: !!user,
      isLoading: false,
    }),

  setToken: (token) => {
    persistToken(token);
    set({ isAuthenticated: true, isLoading: false });
  },

  logout: () => {
    clearToken();
    set({ user: null, isAuthenticated: false, isLoading: false });
  },

  checkAuth: async () => {
    const token = readToken();
    if (!token) {
      set({ user: null, isLoading: false, isAuthenticated: false });
      return;
    }

    set({ isLoading: true });

    try {
      const response = await userApi.getProfile();
      set({
        user: response.data,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error: any) {
      const status = error?.response?.status;

      if (status === 401 || status === 403) {
        clearToken();
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
        });
        return;
      }

      const currentUser = get().user;
      set({
        user: currentUser,
        isAuthenticated: !!currentUser || !!token,
        isLoading: false,
      });
    }
  },
}));

export const useLanguageStore = create<LanguageState>((set) => ({
  language: 'zh',
  hydrated: false,

  setLanguage: (language) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANGUAGE_KEY, language);
      document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    }

    set({ language, hydrated: true });
  },

  hydrateLanguage: () => {
    if (typeof window === 'undefined') {
      set({ hydrated: true });
      return;
    }

    const stored = window.localStorage.getItem(LANGUAGE_KEY);
    const language = stored === 'en' ? 'en' : 'zh';
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    set({ language, hydrated: true });
  },
}));
