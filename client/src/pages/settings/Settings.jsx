import React, { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import SimpleBar from "simplebar-react";
import "simplebar-react/dist/simplebar.min.css";
import {
  UserRound,
  ShieldCheck,
  Palette,
  Languages,
  LogOut,
  Ban,
} from "lucide-react";
import BottomTabBar from "../../components/common/BottomTabBar";
import PageHeader from "../../components/common/PageHeader";
import Profile from "./Profile";
import Appearance from "./Appearance";
import BlockedUsers from "./BlockedUsers";
import Language from "./Language";
import useResponsive from "../../hooks/useResponsive";
import { unsubscribeFromPushNotifications } from "../../utils/notifications";
import "./Settings.css";
import {
  getSidebarWidth,
  setSidebarWidth,
  SIDEBAR_CONFIG
} from "../../utils/storage";

const Settings = ({ isEmbedded = false }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedSetting, setSelectedSetting] = useState(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    return getSidebarWidth();
  });
  const containerRef = useRef(null);
  const isResizingRef = useRef(false);
  const headerRef = useRef(null);
  const bottomTabBarRef = useRef(null);
  const [settingsMenuHeight, setSettingsMenuHeight] = useState(
    "calc(100vh - 200px)"
  );
  const isWideScreen = useResponsive();

  useEffect(() => {
    const calculateHeight = () => {
      const headerHeight = headerRef.current?.offsetHeight || 0;
      const bottomTabHeight = bottomTabBarRef.current?.offsetHeight || 0;
      const totalOffset = headerHeight + bottomTabHeight + 20; // 20px for padding/margin
      setSettingsMenuHeight(`calc(100vh - ${totalOffset}px)`);
    };

    calculateHeight();
    window.addEventListener("resize", calculateHeight);
    return () => window.removeEventListener("resize", calculateHeight);
  }, [selectedSetting]);

  const settingsSections = useMemo(
    () => [
      {
        title: "Account",
        items: [
          {
            id: "profile",
            icon: UserRound,
            label: "Profile",
            path: "/settings/profile",
            description: "Manage your profile information",
            component: Profile,
          },
          {
            id: "security",
            icon: ShieldCheck,
            label: "Security",
            path: "/settings/security",
            description: "Password and authentication",
          },
          {
            id: "blocked-users",
            icon: Ban,
            label: "Blocked Users",
            path: "/settings/blocked-users",
            description: "Manage blocked contacts",
            component: BlockedUsers,
          },
        ],
      },
      {
        title: "Preferences",
        items: [
          {
            id: "appearance",
            icon: Palette,
            label: "Appearance",
            path: "/settings/appearance",
            description: "Theme and display options",
            component: Appearance,
          },
          {
            id: "language",
            icon: Languages,
            label: "Language",
            path: "/settings/language",
            description: "Translation language settings",
            component: Language,
          },
        ],
      },
    ],
    []
  );

  useEffect(() => {
    const selectedSettingId = location.state?.selectedSettingId;
    if (selectedSettingId && isWideScreen) {
      for (const section of settingsSections) {
        const item = section.items.find((item) => item.id === selectedSettingId);
        if (item) {
          setSelectedSetting(item);
          break;
        }
      }
    }
  }, [location.state?.selectedSettingId, isWideScreen, settingsSections]);

  useEffect(() => {
    if (!isWideScreen && selectedSetting?.path) {
      navigate(selectedSetting.path);
    }
  }, [isWideScreen, selectedSetting, navigate]);

  const handleLogout = async () => {
    if (window.confirm("Are you sure you want to logout?")) {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      const userId = user.id || user.user_id;
      const token = localStorage.getItem("accessToken");

      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      localStorage.removeItem("user");
      localStorage.clear();

      Promise.race([
        Promise.all([
          token
            ? unsubscribeFromPushNotifications(token).catch(() => {})
            : Promise.resolve(),
          userId
            ? fetch(
                `${(
                  import.meta.env.VITE_APP_API_URL || "http://localhost:3001"
                ).replace(/\/+$/, "")}/api/auth/logout`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ userId }),
                }
              ).catch(() => {})
            : Promise.resolve(),
        ]),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]).finally(() => {
        window.location.replace("/login");
      });
    }
  };

  const handleItemClick = (item) => {
    if (typeof window !== "undefined" && window.innerWidth < 900) {
      if (item.path) {
        navigate(item.path);
      } else if (item.action) {
        item.action();
      }
    } else {
      setSelectedSetting(item);
    }
  };

  useEffect(() => {
    const handleMouseDown = (e) => {
      if (!containerRef.current) return;
      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const rightEdge = rect.left + leftPanelWidth;

      if (Math.abs(e.clientX - rightEdge) < 5) {
        isResizingRef.current = true;
      }
    };

    const handleMouseMove = (e) => {
      if (!isResizingRef.current || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      let newWidth = e.clientX - rect.left;

      newWidth = Math.max(
        SIDEBAR_CONFIG.MIN_WIDTH,
        Math.min(newWidth, SIDEBAR_CONFIG.MAX_WIDTH)
      );
      setLeftPanelWidth(newWidth);
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
    };

    if (typeof window !== "undefined" && window.innerWidth >= 900) {
      document.addEventListener("mousedown", handleMouseDown);
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);

      return () => {
        document.removeEventListener("mousedown", handleMouseDown);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [leftPanelWidth]);

  return (
    <div className="settings-page" data-embedded={isEmbedded}>
      <div
        className="settings-container"
        ref={containerRef}
        style={
          !isEmbedded &&
          typeof window !== "undefined" &&
          window.innerWidth >= 900
            ? {
                display: "grid",
                gridTemplateColumns: `${leftPanelWidth}px 1fr`,
              }
            : {}
        }
      >
        <div className="settings-left-panel">
          <div ref={headerRef}>
            <PageHeader
              title="Settings"
              backgroundColor="var(--background-color)"
              onBack={() => navigate("/chats")}
            />
          </div>

          <div className="settings-menu-wrapper">
            <SimpleBar style={{ maxHeight: settingsMenuHeight }}>
              <div className="settings-menu">
                {settingsSections.map((section, index) => (
                  <div key={index} className="settings-section">
                    <h2 className="section-title">{section.title}</h2>
                    <div className="settings-items">
                      {section.items.map((item, itemIndex) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={itemIndex}
                            className={`setting-item ${
                              selectedSetting?.id === item.id ? "selected" : ""
                            }`}
                            onClick={() => handleItemClick(item)}
                          >
                            <div className="setting-icon">
                              <Icon size={22} />
                            </div>
                            <div className="setting-info">
                              <h3>{item.label}</h3>
                              <p>{item.description}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <div className="settings-section">
                  <button className="logout-btn" onClick={handleLogout}>
                    <LogOut size={22} />
                    <span>Logout</span>
                  </button>
                </div>
              </div>
            </SimpleBar>
          </div>

          <div ref={bottomTabBarRef}>
            <BottomTabBar activeTab="settings" />
          </div>
        </div>

        {/* Right Panel - Settings Content */}
        <div className="settings-right-panel">
          {selectedSetting ? (
            <>
              {selectedSetting.component ? (
                <selectedSetting.component isEmbedded={true} />
              ) : selectedSetting.path ? (
                <div className="settings-placeholder">
                  <p>Click to navigate to {selectedSetting.label}</p>
                  <button onClick={() => navigate(selectedSetting.path)}>
                    Go to {selectedSetting.label}
                  </button>
                </div>
              ) : selectedSetting.action ? (
                <div className="settings-placeholder">
                  <p>{selectedSetting.label}</p>
                  <button onClick={selectedSetting.action}>
                    {selectedSetting.label}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="settings-placeholder">
              <p>Select a setting from the menu</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
