import React from "react";

interface SuchiAvatarProps {
  size?: "small" | "medium" | "large";
  animated?: boolean;
}

export const SuchiAvatar: React.FC<SuchiAvatarProps> = ({ 
  size = "medium", 
  animated = false 
}) => {
  const sizeMap = {
    small: 32,
    medium: 48,
    large: 64
  };

  const avatarSize = sizeMap[size];

  return (
    <div
      style={{
        width: avatarSize,
        height: avatarSize,
        borderRadius: "50%",
        backgroundColor: "var(--color-primary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-text-on-primary)",
        fontSize: size === "small" ? "16px" : size === "medium" ? "24px" : "32px",
        fontWeight: "bold",
        boxShadow: "var(--shadow-md)",
        animation: animated ? "pulse 2s ease-in-out infinite" : undefined,
        flexShrink: 0
      }}
      aria-label="Suchi avatar"
      role="img"
    >
      S
    </div>
  );
};





