/**
 * Authentication context and hooks using Supabase
 *
 * Provides authentication state management for the entire application.
 * Handles user login, signup, logout, and session persistence.
 * Uses PKCE flow for secure authentication without page redirects.
 */

"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import posthog from 'posthog-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let timeoutId: NodeJS.Timeout | null = null;

    // Set up auth state listener with debouncing to prevent rapid state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Clear any pending timeout
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // Debounce state updates to prevent rapid changes on mobile
        timeoutId = setTimeout(() => {
          if (mounted) {
            setSession(session);
            // Only update user reference if user actually changed (avoid re-renders on token refresh)
            setUser(prev => {
              const newUser = session?.user ?? null;
              if (prev?.id === newUser?.id) return prev;
              return newUser;
            });
            setLoading(false);
            if (session?.user) {
              posthog.identify(session.user.id, { email: session.user.email });
            } else if (event === 'SIGNED_OUT') {
              posthog.reset();
            }
          }
        }, 100);
      }
    );

    // Get initial session with error handling
    supabase.auth.getSession()
      .then(({ data: { session }, error }) => {
        if (error) {
          console.error('Error getting session:', error);
          // Don't fail completely, just set no session
          if (mounted) {
            setSession(null);
            setUser(null);
            setLoading(false);
          }
          return;
        }
        
        if (mounted) {
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
        }
      })
      .catch((error) => {
        console.error('Exception getting session:', error);
        if (mounted) {
          setSession(null);
          setUser(null);
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string) => {
    const redirectUrl = `${window.location.origin}/auth/callback`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl
      }
    });
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      signUp,
      signIn,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};