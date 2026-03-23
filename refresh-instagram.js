const { IgApiClient } = require('instagram-private-api');
const fs = require('fs');

const ig = new IgApiClient();

(async () => {

    ig.state.generateDevice("im_lowkey_failing_maj_proj");

    await ig.simulate.preLoginFlow();

    const username = "im_lowkey_failing_maj_proj";
    const password = "selenium@test05";

    await ig.account.login(username, password);

    await ig.simulate.postLoginFlow();

    const serialized = await ig.state.serialize();
    delete serialized.constants;

    fs.writeFileSync('./session.json', JSON.stringify(serialized));

    console.log("✅ Session saved successfully");

})();