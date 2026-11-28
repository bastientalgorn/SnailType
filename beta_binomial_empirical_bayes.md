# Estimating a Shared Beta Prior from Multiple Boolean Tests

Suppose you have multiple tests \(T_i\).

For each test:

- \(n_i\) = number of observations
- \(k_i\) = number of successes
- \(\hat p_i = k_i/n_i\) = empirical success rate

Assume each test has its own true success probability \(p_i\), but all tests share the same Beta prior:

\[
p_i \sim \mathrm{Beta}(\alpha,\beta)
\]

\[
k_i \mid p_i \sim \mathrm{Binomial}(n_i,p_i)
\]

This is a standard Beta-Binomial hierarchical model.

## Step 1: Estimate the Prior Mean

Compute the overall success rate:

\[
\mu = \frac{\sum_i k_i}{\sum_i n_i}
\]

This estimates the prior mean:

\[
\mu = \frac{\alpha}{\alpha+\beta}
\]

This determines the ratio between \(\alpha\) and \(\beta\).

---

## Step 2: Parameterize the Prior Using θ

Define the prior strength:

\[
\theta = \alpha + \beta
\]

Then:

\[
\alpha = \mu\theta
\]

\[
\beta = (1-\mu)\theta
\]

The remaining question is how to estimate \(\theta\).

---

## Step 3: Estimate θ from Between-Test Variation

If the true probabilities \(p_i\) were directly observable, then for a Beta distribution:

\[
\operatorname{Var}(p_i)
=
\frac{\mu(1-\mu)}{\theta+1}
\]

Rearranging:

\[
\theta
=
\frac{\mu(1-\mu)}{\operatorname{Var}(p_i)}
-1
\]

### Intuition

- Large variation between tests ⇒ small \(\theta\) ⇒ weak prior.
- Small variation between tests ⇒ large \(\theta\) ⇒ strong prior.

---

## Step 4: Correct for Sampling Noise

The true \(p_i\) are not observed directly.

Instead, we observe:

\[
\hat p_i = \frac{k_i}{n_i}
\]

The variance of the empirical proportions contains two components:

\[
\operatorname{Var}(\hat p_i)
=
\operatorname{Var}(p_i)
+
E\left[\frac{p_i(1-p_i)}{n_i}\right]
\]

The second term is ordinary binomial sampling noise.

Let:

\[
s^2
=
\frac{1}{m-1}
\sum_i (\hat p_i-\bar p)^2
\]

where:

- \(m\) = number of tests
- \(\bar p\) = mean of the empirical proportions

A common method-of-moments approximation is:

\[
\widehat{\operatorname{Var}(p_i)}
\approx
s^2
-
\mu(1-\mu)
\frac{1}{m}
\sum_i\frac{1}{n_i}
\]

Then estimate:

\[
\theta
=
\frac{\mu(1-\mu)}
{\widehat{\operatorname{Var}(p_i)}}
-1
\]

This is an empirical Bayes estimate of the shared Beta prior strength.

---

## Step 5: Posterior for a Specific Test

After estimating \(\alpha\) and \(\beta\), the posterior for test \(T_x\) is:

\[
p_x \mid \text{data}
\sim
\mathrm{Beta}
(\alpha+k_x,\beta+n_x-k_x)
\]

The posterior expected probability is:

\[
E[p_x\mid\text{data}]
=
\frac{\alpha+k_x}
{\alpha+\beta+n_x}
\]

Using \(\theta=\alpha+\beta\):

\[
E[p_x\mid\text{data}]
=
\frac{\theta\mu+k_x}
{\theta+n_x}
\]

This makes the shrinkage interpretation clear:

\[
E[p_x\mid\text{data}]
=
w\mu + (1-w)\hat p_x
\]

where:

\[
w = \frac{\theta}{\theta+n_x}
\]

Therefore:

- If \(n_x\) is small, the estimate stays close to the global mean \(\mu\).
- If \(n_x\) is large, the estimate approaches the empirical rate \(\hat p_x\).

---

## Summary

1. Estimate the prior mean:

   \[
   \mu = \frac{\sum_i k_i}{\sum_i n_i}
   \]

2. Estimate the variance of the true test probabilities.

3. Compute:

   \[
   \theta = \frac{\mu(1-\mu)}{\operatorname{Var}(p_i)} - 1
   \]

   (or its sampling-noise-corrected version).

4. Set:

   \[
   \alpha = \mu\theta
   \]

   \[
   \beta = (1-\mu)\theta
   \]

5. For a test with \(k_x\) successes out of \(n_x\) trials:

   \[
   E[p_x\mid\text{data}] = \frac{\theta\mu+k_x}{\theta+n_x}
   \]

This gives an empirical Bayes estimator that automatically shrinks low-sample tests toward the global mean while allowing heavily observed tests to retain their individual characteristics.
