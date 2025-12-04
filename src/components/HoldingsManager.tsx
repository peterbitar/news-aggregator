import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { Holding } from "../types";

const Container = styled.div`
  background-color: #fff;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  margin-bottom: 24px;
`;

const Title = styled.h2`
  font-size: 1.5rem;
  font-weight: bold;
  margin-bottom: 16px;
  color: #1f2937;
`;

const InputGroup = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
`;

const TickerInput = styled.input`
  flex: 1;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  font-size: 0.875rem;
  text-transform: uppercase;
  outline: none;
  transition: border-color 0.3s;

  &:focus {
    border-color: #2563eb;
  }

  &::placeholder {
    text-transform: none;
  }
`;

const AddButton = styled.button`
  padding: 10px 20px;
  background-color: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: background-color 0.3s;

  &:hover {
    background-color: #1d4ed8;
  }

  &:disabled {
    background-color: #9ca3af;
    cursor: not-allowed;
  }
`;

const HoldingsList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
`;

const HoldingItem = styled.li`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background-color: #f9fafb;
  border-radius: 6px;
  margin-bottom: 8px;
`;

const HoldingText = styled.span`
  font-weight: 500;
  color: #1f2937;
`;

const RemoveButton = styled.button`
  padding: 6px 12px;
  background-color: #ef4444;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.3s;

  &:hover {
    background-color: #dc2626;
  }
`;

const EmptyState = styled.p`
  color: #6b7280;
  text-align: center;
  padding: 20px;
  font-style: italic;
`;

const ErrorMessage = styled.p`
  color: #ef4444;
  font-size: 0.875rem;
  margin-top: 8px;
`;

interface HoldingsManagerProps {
  holdings: Holding[];
  onHoldingsChange: (holdings: Holding[]) => void;
}

const HoldingsManager: React.FC<HoldingsManagerProps> = ({
  holdings,
  onHoldingsChange,
}) => {
  const [tickerInput, setTickerInput] = useState("");
  const [error, setError] = useState("");

  const validateTicker = (ticker: string): boolean => {
    // Basic validation: 1-5 uppercase letters/numbers
    const tickerRegex = /^[A-Z0-9]{1,5}$/;
    return tickerRegex.test(ticker.toUpperCase());
  };

  const handleAddTicker = () => {
    const normalizedTicker = tickerInput.trim().toUpperCase();
    setError("");

    if (!normalizedTicker) {
      setError("Please enter a ticker symbol");
      return;
    }

    if (!validateTicker(normalizedTicker)) {
      setError("Invalid ticker format. Use 1-5 letters/numbers (e.g., AAPL, MSFT)");
      return;
    }

    // Check if ticker already exists
    if (holdings.some((h) => h.ticker === normalizedTicker)) {
      setError("This ticker is already in your holdings");
      return;
    }

    // Add the new holding
    const newHolding: Holding = {
      ticker: normalizedTicker,
    };

    onHoldingsChange([...holdings, newHolding]);
    setTickerInput("");
  };

  const handleRemoveTicker = (tickerToRemove: string) => {
    onHoldingsChange(holdings.filter((h) => h.ticker !== tickerToRemove));
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleAddTicker();
    }
  };

  return (
    <Container>
      <Title>💰 Your Holdings</Title>
      <InputGroup>
        <TickerInput
          type="text"
          placeholder="Enter ticker (e.g., AAPL, MSFT, TSLA)"
          value={tickerInput}
          onChange={(e) => {
            setTickerInput(e.target.value.toUpperCase());
            setError("");
          }}
          onKeyPress={handleKeyPress}
          maxLength={5}
        />
        <AddButton onClick={handleAddTicker} disabled={!tickerInput.trim()}>
          Add
        </AddButton>
      </InputGroup>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {holdings.length === 0 ? (
        <EmptyState>No holdings added yet. Add tickers to see relevant news!</EmptyState>
      ) : (
        <HoldingsList>
          {holdings.map((holding) => (
            <HoldingItem key={holding.ticker}>
              <HoldingText>{holding.ticker}</HoldingText>
              <RemoveButton onClick={() => handleRemoveTicker(holding.ticker)}>
                Remove
              </RemoveButton>
            </HoldingItem>
          ))}
        </HoldingsList>
      )}
    </Container>
  );
};

export default HoldingsManager;

