import { useEffect, useState } from 'react';
import { Table, Select, Group, Text, Badge, Paper, Stack, Button } from '@mantine/core';
import { IconChevronUp, IconChevronDown, IconSelector } from '@tabler/icons-react';
import { apiFetch } from '../api';

export interface RunRecord {
  id: number;
  timestamp: string;
  run_type: string;
  model: string;
  provider: string;
  ttft_ms: number;
  prompt_rate: number;
  decode_rate: number;
  total_time_ms: number;
  accuracy: number;
}

export function HistoryTab() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [filteredRuns, setFilteredRuns] = useState<RunRecord[]>([]);
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof RunRecord, direction: 'asc' | 'desc' } | null>(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  useEffect(() => {
    let result = [...runs];

    if (modelFilter) {
      result = result.filter(r => r.model === modelFilter);
    }

    if (sortConfig) {
      result.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (a[sortConfig.key] > b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    setFilteredRuns(result);
  }, [runs, modelFilter, sortConfig]);

  const fetchHistory = async () => {
    try {
      const res = await apiFetch('/api/history');
      if (res.ok) {
        const data = await res.json();
        setRuns(data || []);
      }
    } catch (e) {
      console.error('Failed to fetch history', e);
    }
  };

  const clearHistory = async () => {
    if (window.confirm('Are you sure you want to clear all history?')) {
      try {
        await apiFetch('/api/history', { method: 'DELETE' });
        setRuns([]);
      } catch (e) {
        console.error('Failed to clear history', e);
      }
    }
  };

  const handleSort = (key: keyof RunRecord) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const SortIcon = ({ column }: { column: keyof RunRecord }) => {
    if (sortConfig?.key !== column) return <IconSelector size={14} style={{ opacity: 0.3 }} />;
    return sortConfig.direction === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />;
  };

  const uniqueModels = Array.from(new Set(runs.map(r => r.model)));

  return (
    <Stack>
      <Group justify="space-between">
        <Text fw={500} size="lg">Run History</Text>
        <Group>
          <Button color="red" variant="light" onClick={clearHistory} size="sm">Clear All History</Button>
          <Select
            placeholder="Filter by Model"
            data={uniqueModels}
            value={modelFilter}
            onChange={setModelFilter}
            clearable
            style={{ width: 200 }}
          />
        </Group>
      </Group>

      <Paper withBorder p={0} radius="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => handleSort('timestamp')}>
                <Group gap="xs">Date <SortIcon column="timestamp" /></Group>
              </Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => handleSort('model')}>
                <Group gap="xs">Model <SortIcon column="model" /></Group>
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => handleSort('ttft_ms')}>
                <Group gap="xs">TTFT (ms) <SortIcon column="ttft_ms" /></Group>
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => handleSort('prompt_rate')}>
                <Group gap="xs">Prompt Rate (t/s) <SortIcon column="prompt_rate" /></Group>
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => handleSort('decode_rate')}>
                <Group gap="xs">Decode Rate (t/s) <SortIcon column="decode_rate" /></Group>
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => handleSort('total_time_ms')}>
                <Group gap="xs">Total Time (s) <SortIcon column="total_time_ms" /></Group>
              </Table.Th>
              <Table.Th style={{ cursor: 'pointer' }} onClick={() => handleSort('accuracy')}>
                <Group gap="xs">Accuracy <SortIcon column="accuracy" /></Group>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filteredRuns.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={8} align="center" style={{ padding: '2rem' }}>
                  <Text c="dimmed">No history logs found.</Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              filteredRuns.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>{new Date(r.timestamp).toLocaleString()}</Table.Td>
                  <Table.Td>
                    <Badge color={r.run_type === 'stream' ? 'blue' : 'violet'} variant="light">
                      {r.run_type}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{r.model}</Table.Td>
                  <Table.Td>{r.ttft_ms > 0 ? r.ttft_ms.toFixed(0) : '-'}</Table.Td>
                  <Table.Td>{r.prompt_rate > 0 ? r.prompt_rate.toFixed(1) : '-'}</Table.Td>
                  <Table.Td>{r.decode_rate > 0 ? r.decode_rate.toFixed(1) : '-'}</Table.Td>
                  <Table.Td>{(r.total_time_ms / 1000).toFixed(2)}</Table.Td>
                  <Table.Td>{r.run_type === 'evaluation' ? `${(r.accuracy * 100).toFixed(1)}%` : '-'}</Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}
