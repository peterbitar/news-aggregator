import React from "react";
import styled from "styled-components";

const Container = styled.div`
  margin-bottom: 16px;
`;

const Label = styled.label`
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
  margin-bottom: 8px;
`;

const FilterGroup = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
`;

const SourceButton = styled.button<{ $active: boolean }>`
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid ${(props) => (props.$active ? "#2563eb" : "#d1d5db")};
  background-color: ${(props) => (props.$active ? "#2563eb" : "#fff")};
  color: ${(props) => (props.$active ? "#fff" : "#374151")};
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  gap: 6px;

  &:hover {
    background-color: ${(props) => (props.$active ? "#1d4ed8" : "#f3f4f6")};
    border-color: ${(props) => (props.$active ? "#1d4ed8" : "#9ca3af")};
  }
`;

export type NewsSource = "newsapi" | "gnews";

export interface SourceFilter {
  sources: NewsSource[]; // Empty array means all sources
}

interface SourceFilterProps {
  value: SourceFilter;
  onChange: (filter: SourceFilter) => void;
}

const SourceFilterComponent: React.FC<SourceFilterProps> = ({ value, onChange }) => {
  const hasSource = (source: NewsSource): boolean => {
    return value.sources.length === 0 || value.sources.includes(source);
  };

  const toggleSource = (source: NewsSource) => {
    if (value.sources.length === 0) {
      // Currently showing all, toggle to show only the selected one
      onChange({ sources: [source] });
    } else if (value.sources.includes(source)) {
      // Remove this source
      const newSources = value.sources.filter((s) => s !== source);
      // If no sources selected, show all
      onChange({ sources: newSources.length > 0 ? newSources : [] });
    } else {
      // Add this source
      onChange({ sources: [...value.sources, source] });
    }
  };

  const showAll = value.sources.length === 0;

  return (
    <Container>
      <Label>📰 Filter by Source</Label>
      <FilterGroup>
        <SourceButton
          $active={showAll}
          onClick={() => onChange({ sources: [] })}
        >
          All Sources
        </SourceButton>
        <SourceButton
          $active={hasSource("newsapi") && !showAll}
          onClick={() => toggleSource("newsapi")}
        >
          NewsAPI
        </SourceButton>
        <SourceButton
          $active={hasSource("gnews") && !showAll}
          onClick={() => toggleSource("gnews")}
        >
          GNews
        </SourceButton>
      </FilterGroup>
    </Container>
  );
};

export default SourceFilterComponent;

