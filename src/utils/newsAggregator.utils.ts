/**
 * Utility functions for News Aggregator component
 */

/**
 * Format publication date to readable format
 */
export const formatPublishedDate = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    // Less than a minute ago
    if (diffInSeconds < 60) {
      return "Just now";
    }

    // Less than an hour ago
    if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
    }

    // Less than 24 hours ago
    if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    }

    // Less than 7 days ago
    if (diffInSeconds < 604800) {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days} ${days === 1 ? "day" : "days"} ago`;
    }

    // More than a week ago - show formatted date
    const options: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    };
    return date.toLocaleDateString("en-US", options);
  } catch (error) {
    return "Unknown date";
  }
};

/**
 * Get backend URL based on environment
 */
export const getBackendUrl = (): string => {
  return process.env.NODE_ENV === "development"
    ? "http://localhost:5001"
    : process.env.REACT_APP_BACKEND_URL || "http://localhost:5001";
};
