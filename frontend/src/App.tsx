import React, { useState } from 'react';
import { AppShell, Burger, Group, Title, TextInput, Select, Textarea, Button, Paper, Text, Stack, Card, Grid, ScrollArea, Badge, useMantineTheme, Menu, ActionIcon, Box, TypographyStylesProvider, Switch, Progress, NumberInput, Tabs, Divider } from '@mantine/core';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import { IconBrandOpenai, IconBrain, IconCpu, IconPlayerPlay, IconPlayerStop, IconDatabase, IconChevronDown, IconX, IconRefresh } from '@tabler/icons-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { useLLMStream } from './hooks/useLLMStream';
import { useBenchmarkRun } from './hooks/useBenchmarkRun';
import { HistoryTab } from './components/HistoryTab';
import ReactMarkdown from 'react-markdown';
import { apiFetch } from './api';

const initialModels: any[] = [];

function App() {
  const [opened, { toggle }] = useDisclosure();
  const theme = useMantineTheme();
  
  const [keys, setKeys] = useLocalStorage({
    key: 'api-keys',
    defaultValue: {
      openai: '',
      anthropic: '',
      gemini: '',
      hf: '',
    }
  });
  
  const [models, setModels] = useState(initialModels);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('Write a comprehensive guide on building scalable web applications. Include architecture patterns, database choices, and frontend strategies.');

  const [isLoadingHF, setIsLoadingHF] = useState(false);
  const [evalMode, setEvalMode] = useState(false);
  const [evalDataset, setEvalDataset] = useState<string | null>('cais/mmlu');
  const [evalLimit, setEvalLimit] = useState<number | string>(100);
  const [evalConcurrency, setEvalConcurrency] = useState<string | null>('5');

  const { text, isStreaming, ttft, promptRate, decodeRate, chartData, error: streamError, isLivePromptRate, isLiveDecodeRate, startStream, stopStream } = useLLMStream();
  const { isRunning: isBenchmarking, progress: benchProgress, error: benchError, startBenchmark, stopBenchmark } = useBenchmarkRun();

  const refreshModels = async (provider: string, silent = false) => {
    const key = keys[provider as keyof typeof keys];
    if (!key) {
      if (!silent) alert(`Please enter an API key for ${provider}`);
      return;
    }
    try {
      const res = await apiFetch(`/api/models?provider=${encodeURIComponent(provider)}`, {
        headers: { 'X-Provider-Key': key },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const newModels = data.map((m: any) => ({
        value: m.id,
        label: `${m.id} (${provider.charAt(0).toUpperCase() + provider.slice(1)})`,
        provider: provider,
        apiModel: m.id
      }));
      setModels(prev => {
        const filtered = prev.filter(m => m.provider !== provider);
        return [...filtered, ...newModels];
      });
      if (!silent) alert(`Successfully loaded ${newModels.length} models for ${provider}`);
    } catch (e: any) {
      if (!silent) alert(`Failed to fetch models: ${e.message}`);
    }
  };

  React.useEffect(() => {
    if (keys.openai) refreshModels('openai', true);
    if (keys.anthropic) refreshModels('anthropic', true);
    if (keys.gemini) refreshModels('gemini', true);
  }, []);

  const handleRun = () => {
    const modelDef = models.find(m => m.value === selectedModel);
    if (!modelDef) return;
    
    const apiKey = keys[modelDef.provider as keyof typeof keys];
    if (!apiKey) {
      alert(`Please enter an API key for ${modelDef.provider}`);
      return;
    }

    if (evalMode) {
      const hfToken = keys.hf || '';
      let count = typeof evalLimit === 'number' ? evalLimit : parseInt(evalLimit as string, 10);
      if (isNaN(count)) count = 100;
      
      let concurrency = parseInt(evalConcurrency || '5', 10);
      startBenchmark(modelDef.provider, modelDef.apiModel || modelDef.value, evalDataset || 'cais/mmlu', apiKey, hfToken, count, concurrency);
    } else {
      startStream(modelDef.provider, modelDef.apiModel || modelDef.value, prompt, apiKey);
    }
  };

  const fetchHFQuestion = async (dataset: string, config: string, split: string) => {
    setIsLoadingHF(true);
    try {
      const offset = Math.floor(Math.random() * 50);
      const url = `https://datasets-server.huggingface.co/rows?dataset=${dataset}&config=${config}&split=${split}&offset=${offset}&length=1`;
      
      const headers: any = {};
      if (keys.hf) {
        headers['Authorization'] = `Bearer ${keys.hf}`;
      }

      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`Failed to fetch from HF: ${res.statusText}`);
      
      const data = await res.json();
      if (data.rows && data.rows.length > 0) {
        const row = data.rows[0].row;
        let newPrompt = "";
        
        if (dataset === 'cais/mmlu') {
            newPrompt = `Question: ${row.question}\nOptions:\nA) ${row.choices[0]}\nB) ${row.choices[1]}\nC) ${row.choices[2]}\nD) ${row.choices[3]}\n\nPlease answer with just the letter of the correct option.`;
        } else if (dataset === 'TIGER-Lab/MMLU-Pro') {
            const options = row.options.map((opt: string, i: number) => `${String.fromCharCode(65+i)}) ${opt}`).join('\n');
            newPrompt = `Question: ${row.question}\nOptions:\n${options}\n\nPlease answer with just the letter of the correct option.`;
        }
        
        setPrompt(newPrompt);
        
        // Auto-run benchmark
        if (selectedModel && !evalMode) {
            const modelDef = models.find(m => m.value === selectedModel);
            if (modelDef && keys[modelDef.provider as keyof typeof keys]) {
               startStream(modelDef.provider, modelDef.apiModel || modelDef.value, newPrompt, keys[modelDef.provider as keyof typeof keys]);
            } else {
               alert(`Please enter an API key for ${modelDef?.provider}`);
            }
        }
      }
    } catch (e: any) {
      alert(`Error fetching benchmark: ${e.message}`);
    } finally {
      setIsLoadingHF(false);
    }
  };

  const getProviderIcon = (provider?: string) => {
    switch (provider) {
      case 'openai': return <IconBrandOpenai size={16} />;
      case 'anthropic': return <IconBrain size={16} />;
      case 'gemini': return <IconCpu size={16} />;
      default: return null;
    }
  };

  const activeModel = models.find(m => m.value === selectedModel);
  const isBusy = isStreaming || isBenchmarking;

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: 300,
        breakpoint: 'sm',
        collapsed: { mobile: !opened, desktop: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md">
          <Burger opened={opened} onClick={toggle} size="sm" aria-label="Toggle API keys panel" />
          <Title order={3} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <IconCpu /> LLM Bench
          </Title>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <Stack gap="xl">
          <Box>
            <Text fw={500} mb="xs">API Keys</Text>
            <Stack gap="xs">
              <Divider label="Inference Providers" labelPosition="left" mt="sm" mb="xs" />
              <TextInput
                type="password"
                placeholder="sk-..."
                label="OpenAI"
                value={keys.openai}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeys({ ...keys, openai: e.target.value })}
                onBlur={() => refreshModels('openai', true)}
                leftSection={<IconBrandOpenai size={16} />}
                rightSectionWidth={keys.openai ? 60 : undefined}
                rightSection={keys.openai ? (
                  <Group gap={4}>
                    <ActionIcon size="sm" variant="subtle" onClick={() => refreshModels('openai')}><IconRefresh size={14} /></ActionIcon>
                    <ActionIcon size="sm" variant="subtle" color="red" onClick={() => { setKeys({ ...keys, openai: '' }); setModels(m => m.filter(x => x.provider !== 'openai')); }}><IconX size={14} /></ActionIcon>
                  </Group>
                ) : null}
              />
              <TextInput
                type="password"
                placeholder="sk-ant-..."
                label="Anthropic"
                value={keys.anthropic}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeys({ ...keys, anthropic: e.target.value })}
                onBlur={() => refreshModels('anthropic', true)}
                leftSection={<IconBrain size={16} />}
                rightSectionWidth={keys.anthropic ? 60 : undefined}
                rightSection={keys.anthropic ? (
                  <Group gap={4}>
                    <ActionIcon size="sm" variant="subtle" onClick={() => refreshModels('anthropic')}><IconRefresh size={14} /></ActionIcon>
                    <ActionIcon size="sm" variant="subtle" color="red" onClick={() => { setKeys({ ...keys, anthropic: '' }); setModels(m => m.filter(x => x.provider !== 'anthropic')); }}><IconX size={14} /></ActionIcon>
                  </Group>
                ) : null}
              />
              <TextInput
                type="password"
                placeholder="AIzaSy..."
                label="Gemini"
                value={keys.gemini}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeys({ ...keys, gemini: e.target.value })}
                onBlur={() => refreshModels('gemini', true)}
                leftSection={<IconCpu size={16} />}
                rightSectionWidth={keys.gemini ? 60 : undefined}
                rightSection={keys.gemini ? (
                  <Group gap={4}>
                    <ActionIcon size="sm" variant="subtle" onClick={() => refreshModels('gemini')}><IconRefresh size={14} /></ActionIcon>
                    <ActionIcon size="sm" variant="subtle" color="red" onClick={() => { setKeys({ ...keys, gemini: '' }); setModels(m => m.filter(x => x.provider !== 'gemini')); }}><IconX size={14} /></ActionIcon>
                  </Group>
                ) : null}
              />

              <Divider label="Dataset Repo" labelPosition="left" mt="sm" mb="xs" />
              <TextInput
                type="password"
                placeholder="hf_..."
                label="HuggingFace"
                value={keys.hf}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeys({ ...keys, hf: e.target.value })}
                leftSection={<IconDatabase size={16} />}
                rightSection={keys.hf ? <ActionIcon size="sm" onClick={() => setKeys({ ...keys, hf: '' })}><IconX size={14} /></ActionIcon> : null}
              />
            </Stack>
          </Box>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Tabs defaultValue="dashboard" keepMounted={true}>
          <Tabs.List mb="md">
            <Tabs.Tab value="dashboard" leftSection={<IconCpu size={14} />}>Dashboard</Tabs.Tab>
            <Tabs.Tab value="history" leftSection={<IconDatabase size={14} />}>History</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="dashboard">
            <Stack h="100%" gap="md">
          <Card withBorder shadow="sm" radius="md">
            <Stack>
              <Group grow align="flex-end">
                <Select
                  label="Model"
                  placeholder="Select model"
                  data={models.map(m => ({ value: m.value, label: m.label }))}
                  value={selectedModel}
                  onChange={setSelectedModel}
                  searchable
                  clearable
                  leftSection={getProviderIcon(activeModel?.provider)}
                  style={{ flexGrow: 1 }}
                />
                
                <Group gap={0}>
                    <Button 
                      color={isBusy ? "red" : "blue"}
                      onClick={isBusy ? (isBenchmarking ? stopBenchmark : stopStream) : handleRun}
                      leftSection={isBusy ? <IconPlayerStop size={16} /> : <IconPlayerPlay size={16} />}
                      style={!evalMode ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : {}}
                      loading={isLoadingHF}
                    >
                      {isBusy ? 'Stop' : (evalMode ? 'Run Evaluation' : 'Run Benchmark')}
                    </Button>
                    {!evalMode && (
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon 
                            size={36} 
                            color="blue" 
                            variant="filled" 
                            style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid rgba(255,255,255,0.2)' }}
                            loading={isLoadingHF}
                          >
                            <IconChevronDown size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item leftSection={<IconDatabase size={14} />} onClick={() => fetchHFQuestion('cais/mmlu', 'all', 'test')}>
                            Load Single MMLU (Random)
                          </Menu.Item>
                          <Menu.Item leftSection={<IconDatabase size={14} />} onClick={() => fetchHFQuestion('TIGER-Lab/MMLU-Pro', 'default', 'test')}>
                            Load Single MMLU Pro (Random)
                          </Menu.Item>
                          <Menu.Item leftSection={<IconDatabase size={14} />} onClick={() => fetchHFQuestion('gsm8k', 'main', 'test')}>
                            Load Single GSM8K (Random)
                          </Menu.Item>
                          <Menu.Item leftSection={<IconDatabase size={14} />} onClick={() => fetchHFQuestion('Rowan/hellaswag', 'default', 'validation')}>
                            Load Single HellaSwag (Random)
                          </Menu.Item>
                          <Menu.Item leftSection={<IconDatabase size={14} />} onClick={() => fetchHFQuestion('truthful_qa', 'multiple_choice', 'validation')}>
                            Load Single TruthfulQA (Random)
                          </Menu.Item>
                          <Menu.Item leftSection={<IconDatabase size={14} />} onClick={() => fetchHFQuestion('princeton-nlp/SWE-bench_Lite', 'default', 'test')}>
                            Load Single SWE-bench (Random)
                          </Menu.Item>
                          <Menu.Item leftSection={<IconDatabase size={14} />} onClick={() => fetchHFQuestion('web_arena', 'default', 'test')}>
                            Load Single WebArena (Simulated)
                          </Menu.Item>
                          <Menu.Item leftSection={<IconDatabase size={14} />} onClick={() => fetchHFQuestion('THUDM/AgentBench', 'default', 'test')}>
                            Load Single AgentBench (Simulated)
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    )}
                </Group>
              </Group>

              <Group justify="space-between" mt="sm">
                <Switch
                  label="Full Evaluation Mode"
                  checked={evalMode}
                  onChange={(event) => setEvalMode(event.currentTarget.checked)}
                  color="violet"
                />
              </Group>

              {evalMode ? (
                <Group grow>
                  <Select
                    label="Dataset"
                    data={[
                      { value: 'cais/mmlu', label: 'MMLU' },
                      { value: 'TIGER-Lab/MMLU-Pro', label: 'MMLU Pro' },
                      { value: 'gsm8k', label: 'GSM8K' },
                      { value: 'Rowan/hellaswag', label: 'HellaSwag' },
                      { value: 'truthful_qa', label: 'TruthfulQA' },
                      { value: 'princeton-nlp/SWE-bench_Lite', label: 'SWE-bench Lite' },
                      { value: 'web_arena', label: 'WebArena (Simulated)' },
                      { value: 'THUDM/AgentBench', label: 'AgentBench (Simulated)' }
                    ]}
                    value={evalDataset}
                    onChange={setEvalDataset}
                  />
                  <NumberInput
                    label="Question Limit"
                    value={evalLimit}
                    onChange={setEvalLimit}
                    min={1}
                  />
                  <Select
                    label="Batch Size (Concurrency)"
                    data={[
                      { value: '1', label: '1 (Sequential)' },
                      { value: '2', label: '2' },
                      { value: '4', label: '4' },
                      { value: '8', label: '8' },
                      { value: '16', label: '16' }
                    ]}
                    value={evalConcurrency}
                    onChange={setEvalConcurrency}
                  />
                </Group>
              ) : (
                <Textarea
                  label="Prompt"
                  placeholder="Enter prompt here..."
                  autosize
                  minRows={3}
                  maxRows={6}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              )}
            </Stack>
          </Card>

          {evalMode ? (
            <Card withBorder shadow="sm" radius="md">
              <Stack>
                <Group justify="space-between">
                  <Text fw={500} size="lg">Evaluation Progress</Text>
                  {isBenchmarking && <Badge color="violet" variant="light" className="pulse">Running</Badge>}
                </Group>
                
                <Progress 
                  value={benchProgress.total > 0 ? (benchProgress.processed / benchProgress.total) * 100 : 0} 
                  size="xl" 
                  color="violet"
                  striped 
                  animated={isBenchmarking} 
                />
                
                <Grid>
                  <Grid.Col span={4}>
                    <Paper withBorder p="md" radius="md" ta="center">
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Processed</Text>
                      <Text size="xl" fw={700} c="violet">
                        {benchProgress.processed} / {benchProgress.total > 0 ? benchProgress.total : '--'}
                      </Text>
                    </Paper>
                  </Grid.Col>
                  <Grid.Col span={4}>
                    <Paper withBorder p="md" radius="md" ta="center">
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Correct</Text>
                      <Text size="xl" fw={700} c="teal">
                        {benchProgress.correct}
                      </Text>
                    </Paper>
                  </Grid.Col>
                  <Grid.Col span={4}>
                    <Paper withBorder p="md" radius="md" ta="center">
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Accuracy</Text>
                      <Text size="xl" fw={700} c={benchProgress.processed > 0 ? "blue" : "dimmed"}>
                        {benchProgress.processed > 0 ? `${(benchProgress.accuracy * 100).toFixed(1)}%` : '--'}
                      </Text>
                    </Paper>
                  </Grid.Col>
                </Grid>
                {benchError && <Text c="red" mt="sm">{benchError}</Text>}
              </Stack>
            </Card>
          ) : (
            <>
              <Grid>
                <Grid.Col span={{ base: 12, sm: 4 }}>
                  <Paper withBorder p="md" radius="md" ta="center">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Time to First Token (TTFT)</Text>
                    <Text size="xl" fw={700} c={ttft ? "blue" : "dimmed"}>
                      {ttft ? `${ttft.toFixed(0)} ms` : '--'}
                    </Text>
                  </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 4 }}>
                  <Paper withBorder p="md" radius="md" ta="center" style={{ position: 'relative' }}>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Prompt Processing Rate</Text>
                    <Text size="xl" fw={700} c={promptRate ? "teal" : "dimmed"}>
                      {promptRate ? `${promptRate.toFixed(1)} t/s` : '--'}
                    </Text>
                    {promptRate !== null && (
                      <Badge 
                        size="xs" 
                        variant={isLivePromptRate ? "light" : "outline"} 
                        color={isLivePromptRate ? "teal" : "gray"}
                        style={{ position: 'absolute', top: 10, right: 10 }}
                      >
                        {isLivePromptRate ? "Live (Est.)" : "Average"}
                      </Badge>
                    )}
                  </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 4 }}>
                  <Paper withBorder p="md" radius="md" ta="center" style={{ position: 'relative' }}>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Decode Rate</Text>
                    <Text size="xl" fw={700} c={decodeRate ? "violet" : "dimmed"}>
                      {decodeRate ? `${decodeRate.toFixed(1)} t/s` : '--'}
                    </Text>
                    {decodeRate !== null && (
                      <Badge 
                        size="xs" 
                        variant={isLiveDecodeRate ? "light" : "outline"} 
                        color={isLiveDecodeRate ? "violet" : "gray"}
                        style={{ position: 'absolute', top: 10, right: 10 }}
                      >
                        {isLiveDecodeRate ? "Live" : "Average"}
                      </Badge>
                    )}
                  </Paper>
                </Grid.Col>
              </Grid>

              <Grid grow style={{ flexGrow: 1 }}>
                <Grid.Col span={{ base: 12, md: 8 }} style={{ display: 'flex', flexDirection: 'column' }}>
                  <Paper withBorder p="md" radius="md" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 300 }}>
                      <Group justify="space-between" mb="sm">
                        <Text fw={500}>Output</Text>
                        {isStreaming && <Badge color="blue" variant="light" className="pulse">Streaming</Badge>}
                      </Group>
                      <ScrollArea style={{ flexGrow: 1, height: 0 }}>
                        {text ? (
                          <TypographyStylesProvider p={0}>
                            <ReactMarkdown>{text}</ReactMarkdown>
                          </TypographyStylesProvider>
                        ) : (
                          <Text c="dimmed" fs="italic">Output will appear here...</Text>
                        )}
                      </ScrollArea>
                      {streamError && <Text c="red" mt="sm">{streamError}</Text>}
                  </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 4 }} style={{ display: 'flex', flexDirection: 'column' }}>
                  <Paper withBorder p="md" radius="md" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 300 }}>
                      <Text fw={500} mb="sm">Decode Rate (tokens/s)</Text>
                      <div style={{ flexGrow: 1, height: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={theme.colors.dark[4]} />
                            <XAxis 
                              dataKey="time" 
                              type="number" 
                              domain={['dataMin', 'dataMax']} 
                              tickFormatter={(val) => val.toFixed(1) + 's'}
                              stroke={theme.colors.dark[2]}
                            />
                            <YAxis stroke={theme.colors.dark[2]} />
                            <RechartsTooltip 
                              contentStyle={{ backgroundColor: theme.colors.dark[7], borderColor: theme.colors.dark[5] }}
                              labelFormatter={(val) => `Time: ${Number(val).toFixed(2)}s`}
                              formatter={(val: number) => [val.toFixed(1), 'tokens/s']}
                            />
                            <Line 
                              type="monotone" 
                              dataKey="rate" 
                              stroke={theme.colors.violet[5]} 
                              strokeWidth={2}
                              dot={false}
                              isAnimationActive={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                  </Paper>
                </Grid.Col>
              </Grid>
            </>
          )}
        </Stack>
        </Tabs.Panel>
        
        <Tabs.Panel value="history">
          <HistoryTab />
        </Tabs.Panel>
        </Tabs>
      </AppShell.Main>
    </AppShell>
  );
}

export default App;
