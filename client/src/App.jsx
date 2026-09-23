import React, { useState, createContext } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import OAuthCallback from "./pages/auth/OAuthCallback";
import OTPVerification from "./pages/auth/OTPVerification";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import ChatHome from "./pages/chat/ChatHome";
import ChatWindow from "./pages/chat/ChatWindow";
import AIChatWindow from "./pages/chat/AIChatWindow";
import Profile from "./pages/settings/Profile";
import UserProfile from "./pages/settings/UserProfile";
import Settings from "./pages/settings/Settings";
import Appearance from "./pages/settings/Appearance";
import BlockedUsers from "./pages/settings/BlockedUsers";
import PrivacySettings from "./pages/settings/PrivacySettings";
import Language from "./pages/settings/Language";
import LandingPage from "./pages/LandingPage";
import PrivacyPolicy from "./pages/Legal/PrivacyPolicy";
import TermsOfService from "./pages/Legal/TermsOfService";
import NotFound from "./pages/NotFound/NotFound";
import "./App.css";
import "./styles/theme.css";

export const AuthContext = createContext({ refreshAuth: () => { } });

function App() {
  const [, setAuthState] = useState(0);

  const refreshAuth = () => {
    setAuthState((prev) => prev + 1);
  };

  const hasToken = !!localStorage.getItem("accessToken");

  return (
    <ThemeProvider>
      <AuthContext.Provider value={{ refreshAuth }}>
        <Router>
          <div className="App">
            <Routes>
              <Route
                path="/login"
                element={!hasToken ? <Login /> : <Navigate to="/chats" />}
              />
              <Route
                path="/register"
                element={!hasToken ? <Register /> : <Navigate to="/chats" />}
              />
              <Route path="/verify-otp" element={<OTPVerification />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/oauth-callback" element={<OAuthCallback />} />
              <Route
                path="/chats"
                element={hasToken ? <ChatHome /> : <Navigate to="/login" />}
              />
              <Route
                path="/chat/:chatId"
                element={hasToken ? <ChatWindow /> : <Navigate to="/login" />}
              />
              <Route
                path="/chat/new"
                element={hasToken ? <ChatWindow /> : <Navigate to="/login" />}
              />
              <Route
                path="/ai-chat"
                element={hasToken ? <AIChatWindow /> : <Navigate to="/login" />}
              />
              <Route
                path="/user/:userId"
                element={hasToken ? <UserProfile /> : <Navigate to="/login" />}
              />
              <Route
                path="/settings"
                element={hasToken ? <Settings /> : <Navigate to="/login" />}
              />
              <Route
                path="/settings/profile"
                element={hasToken ? <Profile /> : <Navigate to="/login" />}
              />
              <Route
                path="/settings/appearance"
                element={hasToken ? <Appearance /> : <Navigate to="/login" />}
              />
              <Route
                path="/settings/blocked-users"
                element={hasToken ? <BlockedUsers /> : <Navigate to="/login" />}
              />
              <Route
                path="/settings/privacy"
                element={
                  hasToken ? <PrivacySettings /> : <Navigate to="/login" />
                }
              />
              <Route
                path="/settings/language"
                element={
                  hasToken ? <Language /> : <Navigate to="/login" />
                }
              />
              <Route
                path="/"
                element={
                  hasToken ? <Navigate to="/chats" /> : <LandingPage />
                }
              />
              <Route
                path="/privacy"
                element={<PrivacyPolicy />}
              />
              <Route
                path="/terms"
                element={<TermsOfService />}
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
        </Router>
      </AuthContext.Provider>
    </ThemeProvider>
  );
}

export default App;
