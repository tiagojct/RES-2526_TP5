# Interoperabilidade Semântica nos Registos Electrónicos de Saúde

Repositório da aula prática de Saúde Digital e Inovação Biomédica (2025/2026), FMUP.

## Como usar (GitHub Codespaces)

1. Clicar no botão verde "Code" neste repositório
2. Seleccionar o separador "Codespaces"
3. Clicar em "Create codespace on main"
4. Aguardar ~2 minutos enquanto o ambiente é configurado (Node.js, Python e dependências são instalados automaticamente)

Quando o Codespace abrir, está tudo pronto.

## Estrutura do repositório

```
fhir-aula-sdib/
├── js/                      # Aplicação frontend (Node.js + Express)
│   ├── server.js
│   ├── package.json
│   ├── .env.example
│   ├── views/               # Templates EJS
│   └── public/              # CSS
├── fhir-json/               # Recursos FHIR de exemplo
│   ├── Patient.json
│   ├── Condition.json
│   └── Observation.json
├── python/                  # Script de síntese clínica com LLM
│   └── fhir_llm_summary.py
├── requests.http            # Pedidos HTTP para testar no VS Code
├── requirements.txt         # Dependências Python
└── .devcontainer/           # Configuração do Codespace
```

## Parte 1: Postman (ou REST Client)

### Opção A: Postman

Usar o Postman instalado localmente. Os JSONs de exemplo estão na pasta `fhir-json/`.

Servidor FHIR: `https://hapi.fhir.org/baseR4`

### Opção B: REST Client (dentro do Codespace)

O Codespace inclui a extensão REST Client. Abrir o ficheiro `requests.http` e clicar em "Send Request" por cima de cada pedido. Substituir `{{patient_id}}` pelo ID obtido ao criar o doente.

## Parte 2: Frontend Node.js

No terminal do Codespace:

```bash
cd js
cp .env.example .env
npm start
```

O Codespace detecta automaticamente a porta 3000 e oferece abrir no browser.

Se a porta não abrir automaticamente: separador "Ports" na parte inferior do VS Code, clicar no ícone de globo na porta 3000.

Para parar: Ctrl+C no terminal.

## Parte 3: Síntese clínica com LLM (demonstração)

No terminal do Codespace:

```bash
export OPENROUTER_API_KEY="sk-or-..."
cd python
python fhir_llm_summary.py <PATIENT_ID>
```

Substitui `<PATIENT_ID>` pelo ID do doente criado na parte 1.

O script gera três ficheiros na pasta `python/`:
- `resumo_clinico_<ID>.json` -- dados FHIR + resumo em JSON
- `resumo_clinico_<ID>.md` -- resumo em Markdown
- `resumo_clinico_<ID>.docx` -- resumo em Word

## Links úteis

- Especificação FHIR: https://build.fhir.org/
- Servidor HAPI FHIR: https://hapi.fhir.org/baseR4
- LOINC: https://loinc.org/
- SNOMED CT: https://www.snomed.org/
- ICD-10: https://icd.who.int/browse10

## Notas

- O servidor HAPI FHIR é público e de teste. Não colocar dados reais de doentes.
- O servidor pode ser lento (5-10 segundos por pedido). Ter paciência.
- Se o servidor estiver em baixo, usar como alternativa: `http://test.fhir.org/r4`
