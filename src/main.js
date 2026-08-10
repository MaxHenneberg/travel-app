import './style.css';

const markUrl = `${import.meta.env.BASE_URL}favicon.svg`;

document.querySelector('#app').innerHTML = `
  <section class="welcome" aria-labelledby="welcome-title">
    <img class="mark" src="${markUrl}" width="72" height="72" alt="" />
    <p class="eyebrow">Your next journey starts here</p>
    <h1 id="welcome-title">Hello World</h1>
    <p class="lede">The travel app is ready for takeoff.</p>
    <a class="home-link" href="${import.meta.env.BASE_URL}" aria-label="Return to the welcome page">Home</a>
  </section>
`;
