import React, { createContext, useContext, useEffect, useState } from 'react';

type UserSession = {
  id?: string;
  connected: boolean;
};

type AuthContextType = {
  user: UserSession | null;
  loading: boolean;
  connectDrive: () => void;
  disconnectDrive: () => void;
  checkAuthStatus: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuthStatus = () => {
    const token = localStorage.getItem('drive_auth_token');
    if (token) {
      setUser({ connected: true });
    } else {
      setUser(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    checkAuthStatus();

    const handleMessage = (event: MessageEvent) => {
      // Allow messages, popup might have different origin
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        if (event.data.token) {
          localStorage.setItem('drive_auth_token', event.data.token);
        }
        checkAuthStatus();
      }
    };
    window.addEventListener('message', handleMessage);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'drive_auth_token') {
        checkAuthStatus();
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const connectDrive = async () => {
    try {
      const res = await fetch('/api/auth/url');
      const data = await res.json();
      
      if (data.error) {
        alert(data.error);
        return;
      }
      
      const authWindow = window.open(
        data.url,
        'oauth_popup',
        'width=600,height=700'
      );

      if (!authWindow) {
        alert('Please allow popups to connect Google Drive.');
      }
    } catch (error) {
      console.error('Failed to init OAuth', error);
      alert('Failed to connect. Make sure your OAuth secrets are configured.');
    }
  };

  const disconnectDrive = async () => {
    localStorage.removeItem('drive_auth_token');
    setUser(null);
    // Notify other tabs
    window.dispatchEvent(new Event('storage'));
  };

  return (
    <AuthContext.Provider value={{ user, loading, connectDrive, disconnectDrive, checkAuthStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
