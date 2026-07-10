import VueOfficePdf from './src/main.vue';

VueOfficePdf.install = function (app) {
    app.component(VueOfficePdf.name, VueOfficePdf);
};

export default VueOfficePdf;
