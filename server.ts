/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-loaded GoogleGenAI client helper
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// 1. API - Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const USERS_FILE = path.join(process.cwd(), 'users.json');

// Helper to read users from file database
function readUsersFromFile(): any[] {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      const defaultUsers = [
        {
          name: 'Coordenador NUPBEEP',
          email: 'admin@empresa.com',
          passwordHash: 'admin123'
        }
      ];
      fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2), 'utf-8');
      return defaultUsers;
    }
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Erro ao ler arquivo de usuários:', error);
    return [
      {
        name: 'Coordenador NUPBEEP',
        email: 'admin@empresa.com',
        passwordHash: 'admin123'
      }
    ];
  }
}

// Helper to write users to file database
function writeUsersToFile(users: any[]) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
  } catch (error) {
    console.error('Erro ao salvar arquivo de usuários:', error);
  }
}

// Auth API - Register
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios para cadastro.' });
  }

  const users = readUsersFromFile();
  const targetEmail = email.trim().toLowerCase();
  const userExists = users.some((u: any) => u.email.toLowerCase() === targetEmail);

  if (userExists) {
    return res.status(400).json({ error: 'Este e-mail já está cadastrado em nossa base.' });
  }

  const newUser = {
    name: name.trim(),
    email: targetEmail,
    passwordHash: password
  };

  users.push(newUser);
  writeUsersToFile(users);

  res.json({ success: true, user: { name: newUser.name, email: newUser.email } });
});

// Auth API - Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
  }

  const users = readUsersFromFile();
  const targetEmail = email.trim().toLowerCase();
  const matchedUser = users.find((u: any) => u.email.toLowerCase() === targetEmail && u.passwordHash === password);

  if (!matchedUser) {
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }

  res.json({ success: true, user: { name: matchedUser.name, email: matchedUser.email } });
});

// Auth API - Forgot Request
app.post('/api/auth/forgot-request', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'E-mail é obrigatório.' });
  }

  const users = readUsersFromFile();
  const targetEmail = email.trim().toLowerCase();
  const userExists = users.some((u: any) => u.email.toLowerCase() === targetEmail);

  if (!userExists) {
    return res.status(404).json({ error: 'O e-mail informado não está cadastrado em nossa plataforma.' });
  }

  res.json({ success: true });
});

// Auth API - Reset Password
app.post('/api/auth/forgot-reset', (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) {
    return res.status(400).json({ error: 'E-mail e nova senha são obrigatórios.' });
  }

  const users = readUsersFromFile();
  const targetEmail = email.trim().toLowerCase();
  const userExists = users.some((u: any) => u.email.toLowerCase() === targetEmail);

  if (!userExists) {
    return res.status(404).json({ error: 'Usuário não cadastrado.' });
  }

  const updatedUsers = users.map((u: any) => {
    if (u.email.toLowerCase() === targetEmail) {
      return { ...u, passwordHash: newPassword };
    }
    return u;
  });

  writeUsersToFile(updatedUsers);
  res.json({ success: true });
});

// 2. API - Real-time Meeting Notes summarization & action items extraction
app.post('/api/ai/meeting-minutes', async (req, res) => {
  const { title, participants, rawNotes } = req.body;

  if (!rawNotes || rawNotes.trim() === '') {
    return res.status(400).json({ error: 'Notas brutas são necessárias.' });
  }

  const ai = getGeminiClient();
  if (!ai) {
    // Elegant mockup response when Gemini API Key is missing, so preview remains interactive
    // and guides the user transparently about what AI would do
    return res.json({
      aiSummary: `[Demonstração] Ata de "${title || 'Reunião'}". Para habilitar IA real, configure GEMINI_API_KEY.
A reunião contou com a participação de ${participants || 'equipe'}. Foram discutidas as principais demandas de alinhamento estratégico, metas de engajamento do capital humano e priorização de demandas da equipe.`,
      actionItems: [
        'Definir cronograma para reuniões semanais de 1:1 - Equipe Gestão',
        'Validar novo portal de onboarding com os recém-contratados - Líder de RH',
        'Ajustar métricas de turnover no dashboard estratégico - Equipe Financeira/RH'
      ],
      isDemo: true
    });
  }

  try {
    const prompt = `Analise a transcrição ou as notas brutas desta reunião e crie:
1. Um resumo executivo e profissional em português.
2. Uma lista de ações recomendadas ou tarefas definidas (Action Items), com possíveis responsáveis e prazos sugeridos se houver menção.

Reunião: ${title || 'Sem título'}
Participantes: ${participants || 'Não informados'}
Notas brutas: ${rawNotes}

Por favor, responda estritamente com dados formatados em JSON utilizando o seguinte esquema de resposta.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['summary', 'actionItems'],
          properties: {
            summary: {
              type: Type.STRING,
              description: 'Resumo profissional estruturado das principais discussões em português.'
            },
            actionItems: {
              type: Type.ARRAY,
              items: {
                type: Type.STRING
              },
              description: 'Lista de pontos de ação imediatos e próximos passos definidos.'
            }
          }
        }
      }
    });

    const result = JSON.parse(response.text || '{}');
    return res.json({
      aiSummary: result.summary,
      actionItems: result.actionItems,
      isDemo: false
    });
  } catch (error: any) {
    console.error('Erro na chamada do Gemini:', error);
    return res.status(500).json({
      error: 'Erro ao gerar ata por inteligência artificial. Por favor recarregue ou verifique a chave de API.',
      details: error.message
    });
  }
});

// 3. API - Customized Integration Onboarding Roadmap for New Talents
app.post('/api/ai/onboarding-plan', async (req, res) => {
  const { name, role, department } = req.body;

  if (!name || !role || !department) {
    return res.status(400).json({ error: 'Nome, cargo e departamento são obrigatórios.' });
  }

  const ai = getGeminiClient();
  if (!ai) {
    return res.json({
      tasks: [
        { id: '1', title: `Assinar contratos e documentações de RH para ${role}`, category: 'Documentos', completed: false },
        { id: '2', title: `Integração de hardware e setup de credenciais no setor de ${department}`, category: 'Equipamentos', completed: false },
        { id: '3', title: 'Apresentação formal do time e mentores designados', category: 'Integração', completed: false },
        { id: '4', title: 'Treinamento introdutório sobre cultura organizacional', category: 'Treinamento', completed: false },
        { id: '5', title: 'Reunião de alinhamento de expectativas para a primeira semana', category: 'Integração', completed: false }
      ],
      aiPlan: `[Demonstração] Roteiro para ${name} (${role} - ${department}):
• Para ativar o gerador avançado por IA, defina a chave GEMINI_API_KEY.
• Dias 1-30: Foco absoluto em aculturamento, ferramentas de trabalho do setor de ${department} e setup inicial.
• Dias 31-60: Envolvimento em tarefas secundárias de ${role} com suporte direto de mentores.
• Dias 61-90: Autonomia completa para liderar pequenas entregas e reporte oficial de feedback.`,
      isDemo: true
    });
  }

  try {
    const prompt = `Crie um plano de onboarding (integração) totalmente estruturado para o novo talento:
Nome: ${name}
Cargo: ${role}
Departamento: ${department}

O plano deve conter:
1. Uma lista recomendada de 5 tarefas padrão de integração iniciais específicas para esse departamento e cargo (com categoria relevante: 'Documentos', 'Equipamentos', 'Integração', 'Treinamento').
2. Um roteiro de capacitação para os primeiros 30, 60 e 90 dias (milestones de sucesso do profissional).

Retorne os resultados estritamente em JSON de acordo com o esquema de resposta fornecido.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['suggestedTasks', 'roadmapText'],
          properties: {
            suggestedTasks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ['title', 'category'],
                properties: {
                  title: { type: Type.STRING, description: 'Descrição da tarefa prática de integração.' },
                  category: {
                    type: Type.STRING,
                    enum: ['Documentos', 'Treinamento', 'Equipamentos', 'Integração'],
                    description: 'Categoria da tarefa de onboarding.'
                  }
                }
              }
            },
            roadmapText: {
              type: Type.STRING,
              description: 'Texto estruturado detalhando o plano de desenvolvimento e metas para 30, 60 e 90 dias.'
            }
          }
        }
      }
    });

    const result = JSON.parse(response.text || '{}');
    return res.json({
      tasks: (result.suggestedTasks || []).map((t: any, idx: number) => ({
        id: `ai-${idx}-${Date.now()}`,
        title: t.title,
        category: t.category,
        completed: false
      })),
      aiPlan: result.roadmapText,
      isDemo: false
    });
  } catch (error: any) {
    console.error('Erro ao gerar plano de onboarding:', error);
    return res.status(500).json({
      error: 'Erro ao analisar e criar o plano de onboarding por IA.',
      details: error.message
    });
  }
});

// 4. API - Engagement Diagnostics & Motivation Recommendations
app.post('/api/ai/engagement-analysis', async (req, res) => {
  const { feedbacks } = req.body; // Array of feedbacks and score ratings

  if (!feedbacks || !Array.isArray(feedbacks) || feedbacks.length === 0) {
    return res.status(400).json({ error: 'Dados de pesquisas de engajamento são necessários.' });
  }

  const ai = getGeminiClient();
  if (!ai) {
    return res.json({
      recommendations: `Para habilitar nossa IA Avançada de Engajamento, configure GEMINI_API_KEY.
[Recomendações de Demonstração]:
1. Realize rodadas extras de Feedbacks Semanais (1:1), especialmente em áreas de alta cobranca.
2. Institua um programa informal de reconhecimento (Kudos/Elogios) para aumentar a motivação intrínseca.
3. Alinhe novos rituais flexíveis e workshops de aprendizado interno.`,
      isDemo: true
    });
  }

  try {
    const recordsStr = feedbacks
      .map((f: any, idx: number) => `Colaborador ${idx + 1} (${f.department}): Humor ${f.score}/5, Clima: ${f.feedback || 'Sem feedback adicional'}`)
      .join('\n');

    const prompt = `Você é um consultor líder de Psicologia Organizacional e Recursos Humanos.
Analise os feedbacks de humor e clima da equipe listados abaixo. Forneça uma análise de clima curta e sugira 3 ações estratégicas robustas de engajamento humano que o RH/Gestão podem adotar para mitigar turnover e estimular a motivação intrínseca.

Dados de Clima Reais:
${recordsStr}

Responda em português de forma concisa e amigável direcionada ao setor de RH.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt
    });

    return res.json({
      recommendations: response.text || 'Nenhuma recomendação gerada no momento.',
      isDemo: false
    });
  } catch (error: any) {
    console.error('Erro no diagnóstico de engajamento:', error);
    return res.status(500).json({
      error: 'Erro no processamento da análise de clima.',
      details: error.message
    });
  }
});

// Setup Vite Dev Server / Static Files Serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server em execução na porta ${PORT}`);
  });
}

startServer();
