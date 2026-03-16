require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 5000);
const FHIR_BASE_URL = (process.env.FHIR_BASE_URL || 'https://hapi.fhir.org/baseR4').replace(/\/$/, '');
const FHIR_TIMEOUT = Number(process.env.FHIR_TIMEOUT || 20000);

const http = axios.create({
  baseURL: FHIR_BASE_URL,
  timeout: FHIR_TIMEOUT,
  headers: {
    Accept: 'application/fhir+json, application/json',
    'Content-Type': 'application/fhir+json'
  },
  validateStatus: () => true
});

const METRICS = {
  bp: { label: 'Pressão arterial', codes: ['85354-9', '8480-6', '8462-4'], type: 'bp' },
  egfr: { label: 'TFG / eGFR', codes: ['98979-8'], type: 'lab', unit: 'mL/min/1.73 m2' },
  creatinine: { label: 'Creatinina', codes: ['2160-0'], type: 'lab', unit: 'mg/dL' },
  urea: { label: 'Ureia / BUN', codes: ['3094-0'], type: 'lab', unit: 'mg/dL' }
};

function ensureOk(response, context) {
  if (response.status < 200 || response.status >= 300) {
    const msg = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || {});
    throw new Error(`${context}: ${response.status} ${msg.slice(0, 400)}`);
  }
  return response.data;
}

function formatDate(value) {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '—';
  return value.includes('T')
    ? dt.toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })
    : dt.toLocaleDateString('pt-PT');
}

function getPatientName(patient) {
  const name = (patient.name || [])[0];
  if (!name) return `Paciente ${patient.id || ''}`.trim();
  if (name.text) return name.text;
  return [...(name.given || []), name.family].filter(Boolean).join(' ') || `Paciente ${patient.id || ''}`.trim();
}

function patientField(value) {
  return value || '—';
}

function patientBirthDate(patient) {
  return formatDate(patient.birthDate);
}

function getLoincCodes(obs) {
  return (obs.code?.coding || [])
    .filter((c) => c.system === 'http://loinc.org' && c.code)
    .map((c) => String(c.code));
}

function obsRawDate(obs) {
  return obs.effectiveDateTime || obs.issued || obs.meta?.lastUpdated || '';
}

function sortByDateDesc(list) {
  return [...list].sort((a, b) => new Date(obsRawDate(b)) - new Date(obsRawDate(a)));
}

function observationText(obs) {
  if (obs.code?.text) return obs.code.text;
  const coding = (obs.code?.coding || []).find((c) => c.display) || (obs.code?.coding || [])[0];
  return coding?.display || coding?.code || 'Observação';
}

function quantityText(q) {
  if (!q || q.value === undefined || q.value === null) return '—';
  return `${q.value} ${q.unit || q.code || ''}`.trim();
}

function obsValueText(obs) {
  if (obs.valueQuantity) return quantityText(obs.valueQuantity);
  if (obs.valueString) return obs.valueString;
  if (obs.valueCodeableConcept?.text) return obs.valueCodeableConcept.text;
  return '—';
}

function extractBp(obs) {
  let systolic = '—';
  let diastolic = '—';
  for (const comp of obs.component || []) {
    const codes = (comp.code?.coding || []).map((c) => c.code);
    if (codes.includes('8480-6') && comp.valueQuantity) systolic = quantityText(comp.valueQuantity);
    if (codes.includes('8462-4') && comp.valueQuantity) diastolic = quantityText(comp.valueQuantity);
  }
  return { systolic, diastolic };
}

function conditionText(condition) {
  return condition.code?.text || condition.code?.coding?.[0]?.display || condition.code?.coding?.[0]?.code || '—';
}

function conditionCode(condition) {
  return condition.code?.coding?.[0]?.code || '—';
}

function findMainDiagnosis(conditions) {
  const renal = conditions.find((c) => {
    const text = `${conditionText(c)} ${conditionCode(c)}`.toLowerCase();
    return text.includes('n18') || text.includes('renal') || text.includes('ckd') || text.includes('doença renal') || text.includes('doenca renal');
  });
  return renal || conditions[0] || null;
}

function latestMetricCard(metricKey, observations) {
  const metric = METRICS[metricKey];
  const sorted = sortByDateDesc(observations);
  if (!sorted.length) {
    return { label: metric.label, value: '—', date: '—', loinc: metric.codes.join(', '), note: '—' };
  }
  const latest = sorted[0];
  if (metricKey === 'bp') {
    const bp = extractBp(latest);
    return {
      label: metric.label,
      value: `${bp.systolic !== '—' ? bp.systolic.split(' ')[0] : '?'} / ${bp.diastolic !== '—' ? bp.diastolic.split(' ')[0] : '?'} mmHg`,
      date: formatDate(obsRawDate(latest)),
      loinc: getLoincCodes(latest).join(', ') || metric.codes.join(', '),
      note: (latest.note || []).map((n) => n.text).filter(Boolean).join(' | ') || '—'
    };
  }
  return {
    label: metric.label,
    value: obsValueText(latest),
    date: formatDate(obsRawDate(latest)),
    loinc: getLoincCodes(latest).join(', ') || metric.codes.join(', '),
    note: (latest.note || []).map((n) => n.text).filter(Boolean).join(' | ') || '—'
  };
}

function buildMetricHistory(metricKey, observations) {
  const metric = METRICS[metricKey];
  return sortByDateDesc(observations).map((obs) => {
    let value = obsValueText(obs);
    if (metricKey === 'bp') {
      const bp = extractBp(obs);
      value = `${bp.systolic !== '—' ? bp.systolic.split(' ')[0] : '?'} / ${bp.diastolic !== '—' ? bp.diastolic.split(' ')[0] : '?'} mmHg`;
    }
    return {
      metricKey,
      metricLabel: metric.label,
      date: formatDate(obsRawDate(obs)),
      rawDate: obsRawDate(obs),
      exam: observationText(obs),
      value,
      loinc: getLoincCodes(obs).join(', ') || metric.codes.join(', '),
      status: obs.status || '—'
    };
  });
}

function chartSeries(metricKey, observations) {
  const sorted = [...sortByDateDesc(observations)].reverse();
  if (metricKey === 'bp') {
    return {
      labels: sorted.map((o) => formatDate(obsRawDate(o))),
      systolic: sorted.map((o) => {
        const v = extractBp(o).systolic.split(' ')[0];
        return Number(v) || null;
      }),
      diastolic: sorted.map((o) => {
        const v = extractBp(o).diastolic.split(' ')[0];
        return Number(v) || null;
      })
    };
  }
  return {
    labels: sorted.map((o) => formatDate(obsRawDate(o))),
    values: sorted.map((o) => Number(obsValueText(o).split(' ')[0]) || null)
  };
}

async function loadPatientContext(patientId) {
  const patient = ensureOk(await http.get(`/Patient/${patientId}`), 'Erro ao obter doente');
  const conditionBundle = ensureOk(await http.get('/Condition', { params: { subject: `Patient/${patientId}`, _count: 50 } }), 'Erro ao obter diagnósticos');
  const observationBundle = ensureOk(await http.get('/Observation', { params: { subject: `Patient/${patientId}`, _count: 200, _sort: '-date' } }), 'Erro ao obter observações');

  const conditions = (conditionBundle.entry || []).map((e) => e.resource);
  const observations = (observationBundle.entry || []).map((e) => e.resource);
  const diagnosis = findMainDiagnosis(conditions);

  const metricObservations = {};
  for (const [key, metric] of Object.entries(METRICS)) {
    metricObservations[key] = observations.filter((obs) => getLoincCodes(obs).some((code) => metric.codes.includes(code)));
  }

  const cards = Object.keys(METRICS).map((key) => latestMetricCard(key, metricObservations[key]));
  const historyRows = Object.keys(METRICS)
    .flatMap((key) => buildMetricHistory(key, metricObservations[key]))
    .sort((a, b) => new Date(b.rawDate) - new Date(a.rawDate));

  const charts = {};
  for (const key of Object.keys(METRICS)) charts[key] = chartSeries(key, metricObservations[key]);

  return {
    patient: {
      id: patient.id,
      name: getPatientName(patient),
      birthDate: patientBirthDate(patient),
      gender: patientField(patient.gender),
      diagnosisText: diagnosis ? conditionText(diagnosis) : '—',
      diagnosisCode: diagnosis ? conditionCode(diagnosis) : '—'
    },
    cards,
    historyRows,
    charts
  };
}

function bpObservation(patientId, body) {
  const systolic = Number(body.systolic);
  const diastolic = Number(body.diastolic);
  if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) throw new Error('Preenche sistólica e diastólica.');
  return {
    resourceType: 'Observation',
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs', display: 'Vital Signs' }] }],
    code: { coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel with all children optional' }], text: 'Pressão arterial' },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: body.effectiveDateTime ? new Date(body.effectiveDateTime).toISOString() : new Date().toISOString(),
    component: [
      { code: { coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic blood pressure' }] }, valueQuantity: { value: systolic, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' } },
      { code: { coding: [{ system: 'http://loinc.org', code: '8462-4', display: 'Diastolic blood pressure' }] }, valueQuantity: { value: diastolic, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' } }
    ]
  };
}

function labObservation(patientId, body) {
  const metric = METRICS[body.metricKey];
  const value = Number(body.value);
  if (!metric || metric.type !== 'lab') throw new Error('Métrica inválida.');
  if (!Number.isFinite(value)) throw new Error('Valor inválido.');
  return {
    resourceType: 'Observation',
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory' }] }],
    code: { coding: [{ system: 'http://loinc.org', code: metric.codes[0], display: metric.label }], text: metric.label },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: body.effectiveDateTime ? new Date(body.effectiveDateTime).toISOString() : new Date().toISOString(),
    valueQuantity: { value, unit: metric.unit, system: 'http://unitsofmeasure.org', code: metric.unit }
  };
}

app.use((req, res, next) => {
  res.locals.fhirBaseUrl = FHIR_BASE_URL;
  next();
});

app.get('/', async (req, res, next) => {
  try {
    const bundle = ensureOk(await http.get('/Patient', { params: { _count: 20, _sort: '-_lastUpdated' } }), 'Erro ao listar doentes');
    const patients = (bundle.entry || []).map((e) => e.resource);
    res.render('index', {
      title: 'Lista de doentes',
      patients: patients.map((p) => ({ id: p.id, name: getPatientName(p), birthDate: patientBirthDate(p), gender: patientField(p.gender) }))
    });
  } catch (error) {
    next(error);
  }
});

app.get('/patients/:id', async (req, res, next) => {
  try {
    const context = await loadPatientContext(req.params.id);
    res.render('patient', { title: context.patient.name, ...context, insertedMessage: req.query.inserted || null, metricsConfig: METRICS });
  } catch (error) {
    next(error);
  }
});

app.post('/patients/:id/observations', async (req, res, next) => {
  try {
    const patientId = req.params.id;
    const payload = req.body.type === 'bp' ? bpObservation(patientId, req.body) : labObservation(patientId, req.body);
    ensureOk(await http.post('/Observation', payload), 'Erro ao criar observação');
    res.redirect(`/patients/${patientId}?inserted=${encodeURIComponent('Observação criada com sucesso.')}`);
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  res.status(500).render('error', {
    title: 'Erro',
    message: error.message || 'Erro inesperado.'
  });
});

app.listen(PORT, () => {
  console.log(`FHIR renal app disponível em http://127.0.0.1:${PORT}`);
});
