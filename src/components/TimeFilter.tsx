import React, { useState, useEffect } from "react";
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

const PresetButton = styled.button<{ $active: boolean }>`
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid ${(props) => (props.$active ? "#2563eb" : "#d1d5db")};
  background-color: ${(props) => (props.$active ? "#2563eb" : "#fff")};
  color: ${(props) => (props.$active ? "#fff" : "#374151")};
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.3s;

  &:hover {
    background-color: ${(props) => (props.$active ? "#1d4ed8" : "#f3f4f6")};
    border-color: ${(props) => (props.$active ? "#1d4ed8" : "#9ca3af")};
  }
`;

const DateRangeContainer = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
`;

const DateInput = styled.input`
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.3s;

  &:focus {
    border-color: #2563eb;
  }
`;

const DateLabel = styled.span`
  font-size: 0.875rem;
  color: #6b7280;
`;

export type TimeFilterOption = "all" | "today" | "7days" | "30days" | "custom";

export interface TimeFilter {
  option: TimeFilterOption;
  fromDate?: string; // YYYY-MM-DD format
  toDate?: string;   // YYYY-MM-DD format
}

interface TimeFilterProps {
  value: TimeFilter;
  onChange: (filter: TimeFilter) => void;
}

const TimeFilterComponent: React.FC<TimeFilterProps> = ({ value, onChange }) => {
  const [fromDate, setFromDate] = useState(value.fromDate || "");
  const [toDate, setToDate] = useState(value.toDate || "");

  // Calculate preset dates
  const getTodayDate = (): string => {
    return new Date().toISOString().split("T")[0];
  };

  const getDaysAgoDate = (days: number): string => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split("T")[0];
  };

  const handlePresetClick = (option: TimeFilterOption) => {
    let filter: TimeFilter = { option };

    switch (option) {
      case "today":
        filter.fromDate = getTodayDate();
        filter.toDate = getTodayDate();
        break;
      case "7days":
        filter.fromDate = getDaysAgoDate(7);
        filter.toDate = getTodayDate();
        break;
      case "30days":
        filter.fromDate = getDaysAgoDate(30);
        filter.toDate = getTodayDate();
        break;
      case "all":
        filter.fromDate = undefined;
        filter.toDate = undefined;
        break;
      case "custom":
        // Keep current custom dates
        filter.fromDate = fromDate || undefined;
        filter.toDate = toDate || undefined;
        break;
    }

    onChange(filter);
  };

  const handleCustomDateChange = (type: "from" | "to", date: string) => {
    if (type === "from") {
      setFromDate(date);
      onChange({ option: "custom", fromDate: date, toDate: toDate || undefined });
    } else {
      setToDate(date);
      onChange({ option: "custom", fromDate: fromDate || undefined, toDate: date });
    }
  };

  // Sync local state when value prop changes
  useEffect(() => {
    if (value.option === "custom") {
      setFromDate(value.fromDate || "");
      setToDate(value.toDate || "");
    } else {
      setFromDate("");
      setToDate("");
    }
  }, [value.option, value.fromDate, value.toDate]);

  // Get max date (today) for date inputs
  const maxDate = getTodayDate();

  return (
    <Container>
      <Label>📅 Filter by Date</Label>
      <FilterGroup>
        <PresetButton
          $active={value.option === "all"}
          onClick={() => handlePresetClick("all")}
        >
          All Time
        </PresetButton>
        <PresetButton
          $active={value.option === "today"}
          onClick={() => handlePresetClick("today")}
        >
          Today
        </PresetButton>
        <PresetButton
          $active={value.option === "7days"}
          onClick={() => handlePresetClick("7days")}
        >
          Last 7 Days
        </PresetButton>
        <PresetButton
          $active={value.option === "30days"}
          onClick={() => handlePresetClick("30days")}
        >
          Last 30 Days
        </PresetButton>
        <PresetButton
          $active={value.option === "custom"}
          onClick={() => handlePresetClick("custom")}
        >
          Custom Range
        </PresetButton>

        {value.option === "custom" && (
          <DateRangeContainer>
            <DateLabel>From:</DateLabel>
            <DateInput
              type="date"
              value={fromDate}
              max={maxDate}
              onChange={(e) => handleCustomDateChange("from", e.target.value)}
            />
            <DateLabel>To:</DateLabel>
            <DateInput
              type="date"
              value={toDate}
              max={maxDate}
              min={fromDate}
              onChange={(e) => handleCustomDateChange("to", e.target.value)}
            />
          </DateRangeContainer>
        )}
      </FilterGroup>
    </Container>
  );
};

export default TimeFilterComponent;

