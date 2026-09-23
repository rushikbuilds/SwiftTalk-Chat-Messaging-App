import { useNavigate, useLocation } from "react-router-dom";
import { MessageCircle, Settings } from "lucide-react";
import "./BottomTabBar.css";

const BottomTabBar = ({ activeTab }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const tabs = [
    { id: "chats", label: "Chats", icon: MessageCircle, path: "/chats" },
    { id: "settings", label: "Settings", icon: Settings, path: "/settings" },
  ];

  const handleTabClick = (tab) => {
    if (tab.id === "notifications") {
      alert("Notifications feature - coming soon!");
      return;
    }
    navigate(tab.path);
  };

  return (
    <div className="bottom-tab-bar blurred">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id || location.pathname === tab.path;

        return (
          <button
            key={tab.id}
            className={`tab-btn ${isActive ? "active" : ""}`}
            onClick={() => handleTabClick(tab)}
          >
            <Icon size={24} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default BottomTabBar;
