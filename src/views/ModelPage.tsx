import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { ReactNode } from 'react';
import { EXACT_MAX_N } from '../core/algorithms';

function TeX({ children, block }: { children: string; block?: boolean }) {
  const html = katex.renderToString(children, { displayMode: !!block, throwOnError: false });
  return block ? <div className="my-3" dangerouslySetInnerHTML={{ __html: html }} /> : <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-14 border-t-2 border-ink pt-6">
      <h2 className="text-2xl font-black tracking-tight sm:text-3xl">{title}</h2>
      <div className="mt-4 space-y-3 text-[17px] leading-relaxed">{children}</div>
    </section>
  );
}

export function ModelPage() {
  return (
    <article className="mx-auto max-w-[760px] px-6 py-16 lg:py-20">
      <h1 className="text-[clamp(2.75rem,5vw,4.5rem)] leading-[0.92] font-black tracking-[-0.035em]">The model behind the routes.</h1>
      <p className="mt-6 text-lg leading-relaxed">
        How SwarmRoute turns a city, its traffic and a list of deliveries into an optimisation problem, and how the quantum-inspired search solves it.
      </p>
      <Section title="Road network as a weighted graph">
        <p>
          The city is a graph <TeX>{String.raw`G=(V,E)`}</TeX> of intersections and road segments. Each edge has length{' '}
          <TeX>{String.raw`\ell_e`}</TeX>, free-flow speed <TeX>{String.raw`v_e`}</TeX> and capacity <TeX>{String.raw`\kappa_e`}</TeX>. Its
          time-dependent load is
        </p>
        <TeX block>{String.raw`\rho_e(\tau)=\rho_e^{0}\,\lambda(\tau)\,\iota\,(1+0.18\,\xi_e)+1.6\,\mathbb{1}[e\in\mathcal{I}]`}</TeX>
        <p>
          with the daily demand profile <TeX>{String.raw`\lambda(\tau)`}</TeX> (AM/PM peaks), global intensity <TeX>{String.raw`\iota`}</TeX>, noise{' '}
          <TeX>{String.raw`\xi_e`}</TeX> and incident set <TeX>{String.raw`\mathcal{I}`}</TeX>. Travel time follows the Bureau of Public Roads
          function:
        </p>
        <TeX block>{String.raw`t_e=t_e^{0}\big(1+0.15\,\rho_e^{4}\big),\qquad t_e^{0}=\frac{60\,\ell_e}{v_e}\ \text{min}`}</TeX>
      </Section>

      <Section title="Multi-objective generalised cost">
        <p>Travel time, distance and congestion are combined into one edge cost by a weighted sum:</p>
        <TeX block>{String.raw`w_e=\alpha\,t_e+\beta\,\ell_e+\gamma\,(t_e-t_e^{0})`}</TeX>
        <p>
          Stop-to-stop costs <TeX>{String.raw`c_{ij}`}</TeX> are shortest paths under <TeX>{String.raw`w`}</TeX> (Dijkstra from every stop,{' '}
          <TeX>{String.raw`O\big((n+1)(|V|+|E|)\log|V|\big)`}</TeX>). The matrix is rebuilt whenever traffic changes, which is what makes the routing
          dynamic.
        </p>
      </Section>

      <Section title="Capacitated VRP formulation">
        <p>
          Depot <TeX>0</TeX>, customers <TeX>{String.raw`N=\{1..n\}`}</TeX> with demand <TeX>{String.raw`q_i`}</TeX>, fleet <TeX>{String.raw`K`}</TeX>{' '}
          with capacity <TeX>{String.raw`Q`}</TeX>. With <TeX>{String.raw`x_{ijk}=1`}</TeX> if vehicle <TeX>k</TeX> drives{' '}
          <TeX>{String.raw`i\to j`}</TeX>:
        </p>
        <TeX block>{String.raw`\min\ J=\sum_{k=1}^{K}\sum_{i\neq j} c_{ij}\,x_{ijk}`}</TeX>
        <TeX
          block
        >{String.raw`\text{s.t.}\ \sum_{k}\sum_{i} x_{ijk}=1\ \ \forall j\in N,\qquad \sum_{i} x_{ihk}=\sum_{j} x_{hjk}\ \ \forall h,k`}</TeX>
        <TeX block>{String.raw`\sum_{i\in N} q_i \sum_{j} x_{ijk}\le Q\ \ \forall k,\qquad \sum_{j\in N} x_{0jk}\le 1\ \ \forall k`}</TeX>
        <TeX block>{String.raw`u_i-u_j+Q\,x_{ijk}\le Q-q_j\quad (\text{MTZ subtour elimination})`}</TeX>
        <p>The problem is NP-hard: it generalises the travelling salesman problem.</p>
      </Section>

      <Section title="Constraint handling">
        <p>
          <b>Capacity: feasibility-preserving decoder.</b> A giant tour <TeX>{String.raw`\pi`}</TeX> is cut into routes by Prins’ optimal{' '}
          <em>split</em>, a shortest path on an auxiliary DAG:
        </p>
        <TeX
          block
        >{String.raw`V_j=\min_{i<j}\Big\{V_i+c_{0\pi_{i+1}}+\sum_{k=i+1}^{j-1}c_{\pi_k\pi_{k+1}}+c_{\pi_j0}\ :\ \sum_{k=i+1}^{j}q_{\pi_k}\le Q\Big\}`}</TeX>
        <p>
          <b>Fleet size: penalty function.</b>
        </p>
        <TeX block>{String.raw`F(s)=J(s)+\mu\,\max\big(0,\ |R(s)|-K\big),\qquad \mu=2\max_i(c_{0i}+c_{i0})+1`}</TeX>
      </Section>

      <Section title="Quantum-behaved PSO (QPSO)">
        <p>
          Each particle is a random-key vector <TeX>{String.raw`x_i\in\mathbb{R}^n`}</TeX>, decoded by{' '}
          <TeX>{String.raw`\pi=\operatorname{argsort}(x_i)`}</TeX>. Instead of a velocity, a particle sits in a delta potential well centred on its
          local attractor, and its position is obtained by collapsing the wave function (Monte Carlo sampling):
        </p>
        <TeX block>{String.raw`m^{t}=\frac1M\sum_{i=1}^{M}p_i^{t},\qquad P_{id}=\varphi\,p_{id}+(1-\varphi)\,g_d,\quad \varphi\sim U(0,1)`}</TeX>
        <TeX block>{String.raw`x_{id}^{t+1}=P_{id}\pm\beta(t)\,\big|m_d^{t}-x_{id}^{t}\big|\,\ln\frac1u,\qquad u\sim U(0,1)`}</TeX>
        <TeX block>{String.raw`\beta(t)=\beta_0-(\beta_0-\beta_1)\frac{t}{T}\qquad(\text{converges for }\beta<1.78)`}</TeX>
        <p>
          <b>Quantum tunnelling:</b> each iteration a few keys of <TeX>g</TeX> get heavy-tailed Cauchy jumps{' '}
          <TeX>{String.raw`g_d\leftarrow g_d+\tfrac{3}{n}\tan\big(\pi(u-\tfrac12)\big)`}</TeX>, and the move is kept only if it improves. This lets
          the incumbent escape local basins.
        </p>
        <p>
          <b>Lamarckian hybrid:</b> the best particle of each iteration is improved by local search (2-opt, relocate, swap), and the improved tour is
          written back into its position.
        </p>
      </Section>

      <Section title="Why QPSO vs classical PSO">
        <TeX block>{String.raw`\text{PSO: }\ v\leftarrow w v+c_1r_1(p-x)+c_2r_2(g-x),\quad x\leftarrow x+v`}</TeX>
        <p>
          In PSO the search radius is bounded by the velocity. In QPSO the position density is <TeX>{String.raw`Q(x)\propto e^{-2|x-P|/L}`}</TeX> with{' '}
          <TeX>{String.raw`L=2\beta|m-x|`}</TeX>. It has unbounded support, so a particle can appear anywhere, which gives stronger global search. Its
          spread also shrinks automatically as the swarm converges on <TeX>m</TeX>, which gives exploitation without extra parameters. QPSO needs only
          one control parameter, <TeX>{String.raw`\beta`}</TeX>; PSO needs three (<TeX>{String.raw`w,c_1,c_2`}</TeX>) plus{' '}
          <TeX>{String.raw`v_{\max}`}</TeX>.
        </p>
      </Section>

      <Section title="Complexity">
        <table className="w-full border-y-2 border-ink text-sm">
          <tbody className="divide-y divide-rule">
            {[
              ['Cost matrix (Dijkstra × (n+1))', String.raw`O\big(n(|V|+|E|)\log|V|\big)`],
              ['Random-key decode + split', String.raw`O(n\log n+n\bar L)`],
              ['QPSO iteration (M particles)', String.raw`O\big(M\,n(\log n+\bar L)\big)`],
              ['Local search pass', String.raw`O(n^2)`],
              [`Exact DP (n ≤ ${EXACT_MAX_N})`, String.raw`O(n^2 2^n+n\,3^n)`],
              ['A* / Dijkstra (single pair)', String.raw`O\big((|V|+|E|)\log|V|\big)`],
            ].map(([k, v]) => (
              <tr key={k}>
                <td className="py-2 pr-3">{k}</td>
                <td className="py-2 text-right">
                  <TeX>{v}</TeX>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Metaheuristic cost grows polynomially in <TeX>n</TeX>. The exact method grows as <TeX>{String.raw`3^n`}</TeX>, so it is only used as the
          optimality oracle on small instances.
        </p>
      </Section>

      <Section title="Convergence analysis metrics">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Best-so-far curve</b> <TeX>{String.raw`F^{*}(t)`}</TeX> for every algorithm under an equal evaluation budget{' '}
            <TeX>{String.raw`M\cdot T`}</TeX>.
          </li>
          <li>
            <b>Convergence iteration</b>: <TeX>{String.raw`t_c=\min\{t: F^{*}(t)\le1.01\,F^{*}(T)\}`}</TeX>.
          </li>
          <li>
            <b>Swarm diversity</b> <TeX>{String.raw`D(t)=\frac1M\sum_i\sqrt{\tfrac1n\lVert x_i-\bar x\rVert^2}`}</TeX>, which shows the move from
            exploration to exploitation.
          </li>
          <li>
            <b>Optimality gap</b> <TeX>{String.raw`100\,(F-F^{\mathrm{ref}})/F^{\mathrm{ref}}`}</TeX>. The reference is the exact optimum when{' '}
            <TeX>{String.raw`n\le12`}</TeX>, otherwise the best known solution. Reported as mean ± std over independent seeds.
          </li>
        </ul>
      </Section>
    </article>
  );
}
