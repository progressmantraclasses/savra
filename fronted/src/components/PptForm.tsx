import React, { useState, FormEvent, ChangeEvent } from 'react';
import axios, { AxiosError } from 'axios';
import { upsertRequest } from '../lib/requestStore';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';

const GRADES = Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`);

interface FormState {
  topic: string;
  grade: string;
  subject: string;
  num_slides: number;
}

interface Props {
  onJobStarted: (jobId: string) => void;
}

export default function PptForm({ onJobStarted }: Props) {
  const [form, setForm] = useState<FormState>({
    topic: '',
    grade: 'Class 5',
    subject: '',
    num_slides: 10,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: name === 'num_slides' ? Number(value) : value,
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { data } = await axios.post<{ job_id: string }>(
        `${BACKEND_URL}/generate`,
        form,
      );
      upsertRequest({
        jobId: data.job_id,
        topic: form.topic,
        grade: form.grade,
        subject: form.subject,
        numSlides: form.num_slides,
        status: 'queued',
        outputUrl: null,
        error: null,
      });
      onJobStarted(data.job_id);
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail: any }>;
      const detail = axiosErr.response?.data?.detail;
      
      let errorMsg = 'Failed to submit. Please check if the backend is running.';
      if (typeof detail === 'string') {
        errorMsg = detail;
      } else if (Array.isArray(detail)) {
        errorMsg = detail.map((d: any) => `${d.loc.join('.')}: ${d.msg}`).join(', ');
      }
      
      setError(errorMsg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Topic */}
      <div>
        <label htmlFor="topic" className="field-label">Topic</label>
        <input
          id="topic"
          name="topic"
          type="text"
          required
          placeholder="e.g. The Water Cycle"
          value={form.topic}
          onChange={handleChange}
          className="field-input"
        />
      </div>

      {/* Grade + Subject — side by side on sm+ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="grade" className="field-label">Grade</label>
          <select
            id="grade"
            name="grade"
            value={form.grade}
            onChange={handleChange}
            className="field-input"
          >
            {GRADES.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="subject" className="field-label">Subject</label>
          <input
            id="subject"
            name="subject"
            type="text"
            required
            placeholder="e.g. Science"
            value={form.subject}
            onChange={handleChange}
            className="field-input"
          />
        </div>
      </div>

      {/* Number of slides */}
      <div>
        <label htmlFor="num_slides" className="field-label">
          Number of Slides &nbsp;
          <span className="text-zinc-500 normal-case tracking-normal font-normal">
            (5 – 20)
          </span>
        </label>
        <input
          id="num_slides"
          name="num_slides"
          type="number"
          min={5}
          max={20}
          required
          value={form.num_slides}
          onChange={handleChange}
          className="field-input"
        />
      </div>

      {/* Error */}
      {error && (
        <p className="text-rose-400 text-sm bg-rose-400/10 border border-rose-400/20 rounded-xl px-4 py-2.5">
          {error}
        </p>
      )}

      {/* Submit */}
      <button
        id="generate-btn"
        type="submit"
        disabled={submitting}
        className="btn-primary w-full py-3.5"
      >
        {submitting ? (
          <>
            <span className="spinner" />
            Submitting…
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate Presentation
          </>
        )}
      </button>
    </form>
  );
}
