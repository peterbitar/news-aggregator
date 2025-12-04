import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import styled from "styled-components";
import { Holding } from "../types";

const Container = styled.div`
  background-color: #fff;
  padding: 24px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  margin-bottom: 24px;
`;

const Title = styled.h2`
  font-size: 1.5rem;
  font-weight: bold;
  margin-bottom: 20px;
  color: #1f2937;
`;

const FormContainer = styled.div`
  background-color: #f9fafb;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 24px;
`;

const FormTitle = styled.h3`
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 16px;
  color: #374151;
`;

const FormRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;

  @media (min-width: 640px) {
    flex-direction: row;
    gap: 12px;
  }
`;

const InputContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.label`
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
`;

const Required = styled.span`
  color: #ef4444;
  margin-left: 2px;
`;

const Input = styled.input`
  padding: 10px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.3s;

  &:focus {
    border-color: #2563eb;
  }

  &[type="text"] {
    text-transform: ${(props) => (props.id === "ticker" ? "uppercase" : "none")};
  }
`;

const TextArea = styled.textarea`
  padding: 10px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.3s;
  resize: vertical;
  min-height: 60px;
  font-family: inherit;

  &:focus {
    border-color: #2563eb;
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 8px;
`;

const AddButton = styled.button`
  padding: 10px 20px;
  background-color: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  font-size: 0.875rem;
  transition: background-color 0.3s;

  &:hover {
    background-color: #1d4ed8;
  }

  &:disabled {
    background-color: #9ca3af;
    cursor: not-allowed;
  }
`;

const ClearButton = styled.button`
  padding: 10px 20px;
  background-color: #6b7280;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  font-size: 0.875rem;
  transition: background-color 0.3s;

  &:hover {
    background-color: #4b5563;
  }
`;

const ErrorMessage = styled.p`
  color: #ef4444;
  font-size: 0.875rem;
  margin-top: 8px;
`;

const LoadingMessage = styled.p`
  color: #6b7280;
  font-size: 0.875rem;
  margin-top: 8px;
  font-style: italic;
`;

const HoldingsContainer = styled.div`
  margin-top: 24px;
`;

const HoldingsTitle = styled.h3`
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 16px;
  color: #374151;
`;

const HoldingsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 12px;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

const HoldingChip = styled.div`
  background-color: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  position: relative;
  transition: box-shadow 0.3s;

  &:hover {
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }
`;

const ChipHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
`;

const ChipTicker = styled.div`
  font-weight: 700;
  font-size: 1.125rem;
  color: #1f2937;
  letter-spacing: 0.5px;
`;

const DeleteButton = styled.button`
  background-color: transparent;
  border: none;
  color: #ef4444;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 1.25rem;
  line-height: 1;
  transition: background-color 0.3s;

  &:hover {
    background-color: #fee2e2;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ChipLabel = styled.div`
  font-size: 0.875rem;
  color: #6b7280;
  margin-bottom: 8px;
  font-style: italic;
`;

const ChipNotes = styled.div`
  font-size: 0.875rem;
  color: #4b5563;
  line-height: 1.5;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #e5e7eb;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 40px 20px;
  color: #6b7280;
`;

const EmptyStateText = styled.p`
  font-size: 1rem;
  margin-bottom: 8px;
`;

const EmptyStateSubtext = styled.p`
  font-size: 0.875rem;
  font-style: italic;
`;

// Backend URL helper
const getBackendUrl = () => {
  return process.env.NODE_ENV === "development"
    ? "http://localhost:5001"
    : process.env.REACT_APP_BACKEND_URL || "http://localhost:5001";
};

// API functions
const fetchHoldings = async (): Promise<Holding[]> => {
  const response = await axios.get(`${getBackendUrl()}/api/holdings`);
  return response.data;
};

const createHolding = async (holding: Omit<Holding, "id">): Promise<Holding> => {
  const response = await axios.post(`${getBackendUrl()}/api/holdings`, holding);
  return response.data;
};

const deleteHolding = async (id: number): Promise<void> => {
  await axios.delete(`${getBackendUrl()}/api/holdings/${id}`);
};

const HoldingsPanel: React.FC = () => {
  const [ticker, setTicker] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const queryClient = useQueryClient();

  // Fetch holdings from backend
  const {
    data: holdings = [],
    isLoading,
    error: fetchError,
  } = useQuery({
    queryKey: ["holdings"],
    queryFn: fetchHoldings,
    staleTime: 30 * 1000, // Consider fresh for 30 seconds
  });

  // Mutation for adding a holding
  const addMutation = useMutation({
    mutationFn: createHolding,
    onSuccess: () => {
      // Invalidate and refetch holdings
      queryClient.invalidateQueries({ queryKey: ["holdings"] });
      // Reset form
      setTicker("");
      setLabel("");
      setNotes("");
      setError("");
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || "Failed to add holding");
    },
  });

  // Mutation for deleting a holding
  const deleteMutation = useMutation({
    mutationFn: deleteHolding,
    onSuccess: () => {
      // Invalidate and refetch holdings
      queryClient.invalidateQueries({ queryKey: ["holdings"] });
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || "Failed to delete holding");
    },
  });

  const validateTicker = (tickerValue: string): boolean => {
    // Basic validation: 1-5 uppercase letters/numbers
    const tickerRegex = /^[A-Z0-9]{1,5}$/;
    return tickerRegex.test(tickerValue.toUpperCase());
  };

  const handleAddHolding = () => {
    const normalizedTicker = ticker.trim().toUpperCase();
    setError("");

    if (!normalizedTicker) {
      setError("Ticker is required");
      return;
    }

    if (!validateTicker(normalizedTicker)) {
      setError("Invalid ticker format. Use 1-5 letters/numbers (e.g., AAPL, NVDA)");
      return;
    }

    // Check if ticker already exists in current holdings
    if (holdings.some((h) => h.ticker === normalizedTicker)) {
      setError("This ticker is already in your holdings");
      return;
    }

    // Create holding via mutation
    addMutation.mutate({
      ticker: normalizedTicker,
      label: label.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  const handleDeleteHolding = (id: number) => {
    if (window.confirm("Are you sure you want to remove this holding?")) {
      deleteMutation.mutate(id);
    }
  };

  const handleClearForm = () => {
    setTicker("");
    setLabel("");
    setNotes("");
    setError("");
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.ctrlKey) {
      handleAddHolding();
    }
  };

  // Show error from fetch if any
  const displayError = error || (fetchError ? "Failed to load holdings" : null);

  return (
    <Container>
      <Title>💰 My Holdings</Title>

      <FormContainer>
        <FormTitle>Add New Holding</FormTitle>
        <FormRow>
          <InputContainer style={{ flex: "0 0 150px" }}>
            <Label htmlFor="ticker">
              Ticker<Required>*</Required>
            </Label>
            <Input
              id="ticker"
              type="text"
              placeholder="NVDA"
              value={ticker}
              onChange={(e) => {
                setTicker(e.target.value.toUpperCase());
                setError("");
              }}
              onKeyPress={handleKeyPress}
              maxLength={5}
            />
          </InputContainer>
          <InputContainer>
            <Label htmlFor="label">Label (Optional)</Label>
            <Input
              id="label"
              type="text"
              placeholder="Nvidia"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyPress={handleKeyPress}
            />
          </InputContainer>
        </FormRow>
        <InputContainer>
          <Label htmlFor="notes">Notes (Optional)</Label>
          <TextArea
            id="notes"
            placeholder="Optional notes about this holding..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyPress={handleKeyPress}
          />
        </InputContainer>
        {displayError && <ErrorMessage>{displayError}</ErrorMessage>}
        {addMutation.isPending && <LoadingMessage>Adding holding...</LoadingMessage>}
        <ButtonGroup>
          <AddButton
            onClick={handleAddHolding}
            disabled={!ticker.trim() || addMutation.isPending}
          >
            {addMutation.isPending ? "Adding..." : "Add Holding"}
          </AddButton>
          <ClearButton onClick={handleClearForm}>Clear</ClearButton>
        </ButtonGroup>
      </FormContainer>

      <HoldingsContainer>
        <HoldingsTitle>
          Current Holdings ({holdings.length})
        </HoldingsTitle>
        {isLoading ? (
          <EmptyState>
            <EmptyStateText>Loading holdings...</EmptyStateText>
          </EmptyState>
        ) : holdings.length === 0 ? (
          <EmptyState>
            <EmptyStateText>No holdings added yet</EmptyStateText>
            <EmptyStateSubtext>
              Add tickers above to track your portfolio
            </EmptyStateSubtext>
          </EmptyState>
        ) : (
          <HoldingsGrid>
            {holdings.map((holding) => (
              <HoldingChip key={holding.id || holding.ticker}>
                <ChipHeader>
                  <ChipTicker>{holding.ticker}</ChipTicker>
                  <DeleteButton
                    onClick={() => holding.id && handleDeleteHolding(holding.id)}
                    disabled={!holding.id || deleteMutation.isPending}
                    aria-label={`Delete ${holding.ticker}`}
                  >
                    ×
                  </DeleteButton>
                </ChipHeader>
                {holding.label && (
                  <ChipLabel>{holding.label}</ChipLabel>
                )}
                {holding.notes && (
                  <ChipNotes>{holding.notes}</ChipNotes>
                )}
              </HoldingChip>
            ))}
          </HoldingsGrid>
        )}
      </HoldingsContainer>
    </Container>
  );
};

export default HoldingsPanel;
