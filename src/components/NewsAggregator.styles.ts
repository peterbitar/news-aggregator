import styled from "styled-components";

export const Container = styled.div`
  min-height: 100vh;
  background-color: #f3f4f6;
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
`;

export const Title = styled.h1`
  font-size: 2rem;
  font-weight: bold;
  text-align: center;
  margin-bottom: 24px;
`;

export const ButtonGroup = styled.div`
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 8px;
`;

export const TabContainer = styled.div`
  display: flex;
  justify-content: center;
  margin-bottom: 24px;
  gap: 8px;
`;

export const TabButton = styled.button<{ $active?: boolean }>`
  padding: 12px 24px;
  border-radius: 8px;
  color: #fff;
  background-color: ${(props) => (props.$active ? "#2563eb" : "#6b7280")};
  cursor: pointer;
  transition: all 0.3s;
  font-weight: 600;
  font-size: 0.95rem;
  border: none;
  box-shadow: ${(props) => (props.$active ? "0 4px 8px rgba(37, 99, 235, 0.3)" : "0 2px 4px rgba(0, 0, 0, 0.1)")};

  &:hover {
    background-color: ${(props) => (props.$active ? "#1d4ed8" : "#4b5563")};
    transform: translateY(-2px);
  }
`;

export const ScrapeButton = styled.button<{ $bgColor?: string }>`
  background: ${(props) => props.$bgColor || "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"};
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

  &:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

export const SourceCheckboxContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  margin-bottom: 16px;
  flex-wrap: wrap;
`;

export const SourceCheckboxLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 0.9rem;
  color: #374151;
  user-select: none;

  &:hover {
    color: #2563eb;
  }
`;

export const SourceCheckbox = styled.input`
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #2563eb;
`;

export const SourceCheckboxText = styled.span`
  font-weight: 500;
`;

export const SourceLimitInput = styled.input`
  width: 60px;
  padding: 4px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 0.875rem;
  text-align: center;
  margin-left: 8px;

  &:focus {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
  }

  &:disabled {
    background-color: #f3f4f6;
    cursor: not-allowed;
    opacity: 0.6;
  }
`;

export const Button = styled.button<{ $active?: boolean }>`
  padding: 8px 16px;
  margin: 0 8px;
  border-radius: 8px;
  color: #fff;
  background-color: ${(props) => (props.$active ? "#2563eb" : "#6b7280")};
  cursor: pointer;
  transition: background-color 0.3s;

  &:hover {
    background-color: ${(props) => (props.$active ? "#1d4ed8" : "#4b5563")};
  }
`;

export const LoadingState = styled.p`
  text-align: center;
  color: #4b5563;
`;

export const NewsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(1, 1fr);
  gap: 16px;

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }

  @media (min-width: 1024px) {
    grid-template-columns: repeat(3, 1fr);
  }
`;

export const NewsCard = styled.div`
  background-color: #fff;
  padding: 16px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.3s, box-shadow 0.3s;

  &:hover {
    transform: scale(1.02);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  img {
    width: 100%;
    height: 192px;
    object-fit: cover;
    border-radius: 8px;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: bold;
    margin-top: 8px;
  }

  p {
    color: #4b5563;
    font-size: 0.875rem;
    margin-top: 4px;
  }

  a {
    display: block;
    margin-top: 16px;
    color: #2563eb;
    font-weight: bold;
    text-decoration: none;

    &:hover {
      color: #1d4ed8;
    }
  }
`;

export const ArticleMeta = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  margin-bottom: 4px;
  flex-wrap: wrap;
  gap: 8px;
`;

export const PublicationDate = styled.span`
  color: #6b7280;
  font-size: 0.75rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
`;

export const FeedSourceBadge = styled.span<{ $source: string }>`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  background-color: ${(props) => {
    if (props.$source === "gnews") return "#e0f2fe";
    if (props.$source === "newsapi") return "#fef3c7";
    return "#f3f4f6";
  }};
  color: ${(props) => {
    if (props.$source === "gnews") return "#0369a1";
    if (props.$source === "newsapi") return "#92400e";
    return "#6b7280";
  }};
  border: 1px solid ${(props) => {
    if (props.$source === "gnews") return "#7dd3fc";
    if (props.$source === "newsapi") return "#fde047";
    return "#e5e7eb";
  }};
`;

export const EnrichmentSection = styled.div`
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
`;

export const SummaryText = styled.p`
  color: #374151;
  font-size: 0.875rem;
  line-height: 1.6;
  margin: 8px 0;
  font-style: italic;
`;

export const WhyItMattersText = styled.p`
  color: #1f2937;
  font-size: 0.875rem;
  line-height: 1.6;
  margin: 8px 0;
  font-weight: 500;
`;

export const RelevanceBadges = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
`;

export const RelevanceBadge = styled.span<{ $score: number }>`
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background-color: ${(props) => {
    if (props.$score >= 70) return "#dcfce7";
    if (props.$score >= 40) return "#fef3c7";
    return "#f3f4f6";
  }};
  color: ${(props) => {
    if (props.$score >= 70) return "#166534";
    if (props.$score >= 40) return "#92400e";
    return "#6b7280";
  }};
  border: 1px solid ${(props) => {
    if (props.$score >= 70) return "#86efac";
    if (props.$score >= 40) return "#fde047";
    return "#e5e7eb";
  }};
`;

export const ToggleContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px;
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
`;

export const ToggleLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
`;

export const ToggleSwitch = styled.input`
  width: 44px;
  height: 24px;
  border-radius: 12px;
  background-color: #9ca3af;
  appearance: none;
  position: relative;
  cursor: pointer;
  transition: background-color 0.3s;

  &:checked {
    background-color: #2563eb;
  }

  &:before {
    content: "";
    position: absolute;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background-color: #fff;
    top: 2px;
    left: 2px;
    transition: transform 0.3s;
  }

  &:checked:before {
    transform: translateX(20px);
  }
`;

export const PaginationButtonsContainer = styled.div`
  text-align: center;
  margin-top: 20px;
`;

export const PaginationButton = styled.button<{ disabled: boolean }>`
  padding: 8px 16px;
  margin-right: 10px;
  border-radius: 5px;
  border: none;
  background: #2563eb;
  color: #fff;
  cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
  opacity: ${(props) => (props.disabled ? 0.5 : 1)};
`;

export const PaginationText = styled.span`
  margin: 0px 10px;
`;

export const SearchContainer = styled.div`
  text-align: center;
  margin-bottom: 16px;
`;

export const SearchBox = styled.input`
  padding: 10px;
  width: 100%;
  max-width: 500px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  outline: none;
  transition: border-color 0.3s;

  &:focus {
    border-color: #2563eb;
  }
`;
